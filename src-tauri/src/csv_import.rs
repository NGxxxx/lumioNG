//! CSV import: parses a delimited file whose header row may use dot-paths (`address.city`, the
//! same convention `domain/exporter.ts::flattenPaths` writes on export) and rebuilds each row into
//! a nested document, reusing `value_infer` for cell-level type inference — the same module SQL
//! import uses, so both formats reconstruct nested objects/scalars identically.
use crate::value_infer::{infer_bson, InferOptions};
use mongodb::bson::{Bson, Document};
use std::collections::HashSet;
use std::io::Read;

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvDelimiter {
    Comma,
    Semicolon,
    Tab,
}

impl CsvDelimiter {
    pub fn as_byte(self) -> u8 {
        match self {
            CsvDelimiter::Comma => b',',
            CsvDelimiter::Semicolon => b';',
            CsvDelimiter::Tab => b'\t',
        }
    }
}

/// Short type label for one inferred `Bson` value, used by the preview command to annotate each
/// column (`"int"`, `"double"`, `"bool"`, `"objectId"`, `"date"`, `"object"`, `"array"`, `"null"`,
/// or the `"string"` fallback).
pub fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Int32(_) | Bson::Int64(_) => "int",
        Bson::Double(_) => "double",
        Bson::Boolean(_) => "bool",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Null => "null",
        _ => "string",
    }
}

/// Inserts `value` at a possibly dotted `path` inside `doc`, creating intermediate sub-documents
/// as needed — the inverse of `domain/schema.ts::walkLeaves`. A path segment that collides with an
/// already-inserted non-document value is overwritten with a fresh sub-document rather than
/// erroring (a malformed/conflicting header pair is an edge case, not worth aborting the row over).
fn insert_dotted(doc: &mut Document, path: &str, value: Bson) {
    match path.split_once('.') {
        None => {
            doc.insert(path, value);
        }
        Some((head, rest)) => {
            let entry = doc
                .entry(head.to_string())
                .or_insert_with(|| Bson::Document(Document::new()));
            if !matches!(entry, Bson::Document(_)) {
                *entry = Bson::Document(Document::new());
            }
            if let Bson::Document(sub) = entry {
                insert_dotted(sub, rest, value);
            }
        }
    }
}

/// Converts one CSV row (`headers[i]` paired with `values[i]`) into a document: each cell's raw
/// text goes through `infer_bson` (same as a SQL string literal), then lands at its — possibly
/// dotted — header path via `insert_dotted`.
pub fn unflatten_row(headers: &[String], values: &[String], opts: &InferOptions) -> Document {
    let mut doc = Document::new();
    for (header, value) in headers.iter().zip(values.iter()) {
        insert_dotted(&mut doc, header, infer_bson(value, opts));
    }
    doc
}

/// Opens a CSV reader over `rdr` with the given `delimiter` and returns its header row (owned,
/// decoupled from the reader's internal borrow) alongside the reader itself, ready for
/// `.records()`. The one place `csv::ReaderBuilder` is constructed in this module.
pub fn open_reader<R: Read>(rdr: R, delimiter: CsvDelimiter) -> Result<(Vec<String>, csv::Reader<R>), String> {
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter.as_byte()).from_reader(rdr);
    let headers = reader
        .headers()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|s| s.to_string())
        .collect();
    Ok((headers, reader))
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvColumnPreview {
    pub path: String,
    pub inferred_type: String,
    pub samples: Vec<String>,
}

/// Reads only the header plus up to `max_rows` data rows (never the whole file) to report each
/// column's path, inferred type (`"mixed"` when sampled rows disagree, `"empty"` when every
/// sampled cell was blank/absent), and up to 3 raw sample values. A malformed row (wrong field
/// count for the header) is skipped from contributing samples and type inference, but still counts
/// toward `max_rows` — a run of malformed rows cannot force a full-file scan.
pub fn preview_columns<R: Read>(
    rdr: R,
    delimiter: CsvDelimiter,
    max_rows: usize,
    opts: &InferOptions,
) -> Result<Vec<CsvColumnPreview>, String> {
    let (headers, mut reader) = open_reader(rdr, delimiter)?;
    let mut samples: Vec<Vec<String>> = vec![Vec::new(); headers.len()];
    let mut types: Vec<HashSet<&'static str>> = vec![HashSet::new(); headers.len()];
    let mut attempted = 0usize;

    for result in reader.records() {
        if attempted >= max_rows {
            break;
        }
        attempted += 1;
        let record = match result {
            Ok(r) => r,
            Err(_) => continue,
        };
        for (col, cell) in record.iter().enumerate() {
            if col >= headers.len() {
                continue;
            }
            if samples[col].len() < 3 {
                samples[col].push(cell.to_string());
            }
            types[col].insert(bson_type_name(&infer_bson(cell, opts)));
        }
    }

    Ok(headers
        .into_iter()
        .enumerate()
        .map(|(i, path)| {
            let inferred_type = match types[i].len() {
                0 => "empty".to_string(),
                1 => types[i].iter().next().unwrap().to_string(),
                _ => "mixed".to_string(),
            };
            CsvColumnPreview { path, inferred_type, samples: samples[i].clone() }
        })
        .collect())
}

/// One converted (or failed-to-convert) CSV data row, tagged with its 0-based row index among
/// data rows (excluding the header) — used to build a `doc#N: ...` error message that matches the
/// row a user would count in their spreadsheet tool.
#[derive(Debug)]
pub enum CsvRow {
    Doc(usize, Document),
    ParseError(usize, String),
}

/// Converts one raw CSV read result into a `CsvRow`. A structural error (e.g. a row with the
/// wrong number of fields for the header — `ErrorKind::UnequalLengths`) becomes a `ParseError`
/// rather than propagating — the csv crate's reader position already advances past the bad line
/// internally, so the next call still reads the following row (proven by
/// `convert_record_reports_a_parse_error_for_a_ragged_row_and_keeps_reading`).
pub fn convert_record(
    row_no: usize,
    result: Result<csv::StringRecord, csv::Error>,
    headers: &[String],
    opts: &InferOptions,
) -> CsvRow {
    match result {
        Ok(record) => {
            let values: Vec<String> = record.iter().map(|s| s.to_string()).collect();
            CsvRow::Doc(row_no, unflatten_row(headers, &values, opts))
        }
        Err(e) => CsvRow::ParseError(row_no, e.to_string()),
    }
}

/// Counts data rows (excluding the header) without building a single `Bson` value — every row
/// attempt counts, whether it will later convert cleanly or fail, so the count matches
/// `convert_record`'s row numbering and can be used as the commit progress total up front.
pub fn count_csv_rows<R: Read>(rdr: R, delimiter: CsvDelimiter) -> Result<u64, String> {
    let (_, mut reader) = open_reader(rdr, delimiter)?;
    Ok(reader.records().count() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value_infer::InferOptions;
    use mongodb::bson::Bson;

    fn opts(parse_json_like: bool, infer_scalars: bool) -> InferOptions {
        InferOptions { parse_json_like, infer_scalars }
    }

    #[test]
    fn delimiter_maps_to_the_right_byte() {
        assert_eq!(CsvDelimiter::Comma.as_byte(), b',');
        assert_eq!(CsvDelimiter::Semicolon.as_byte(), b';');
        assert_eq!(CsvDelimiter::Tab.as_byte(), b'\t');
    }

    #[test]
    fn bson_type_name_covers_every_inferable_type() {
        assert_eq!(bson_type_name(&Bson::String("x".into())), "string");
        assert_eq!(bson_type_name(&Bson::Int64(1)), "int");
        assert_eq!(bson_type_name(&Bson::Double(1.5)), "double");
        assert_eq!(bson_type_name(&Bson::Boolean(true)), "bool");
        assert_eq!(bson_type_name(&Bson::Null), "null");
        assert!(matches!(bson_type_name(&Bson::Array(vec![])), "array"));
    }

    #[test]
    fn unflatten_row_builds_a_flat_document_for_plain_headers() {
        let doc = unflatten_row(
            &["id".into(), "name".into()],
            &["1".into(), "Ada".into()],
            &opts(true, true),
        );
        assert_eq!(doc.get_i64("id").unwrap(), 1);
        assert_eq!(doc.get_str("name").unwrap(), "Ada");
    }

    #[test]
    fn unflatten_row_rebuilds_a_two_level_dotted_path_into_a_nested_document() {
        let doc = unflatten_row(
            &["address.city".into(), "address.zip".into()],
            &["Hanoi".into(), "100000".into()],
            &opts(true, true),
        );
        let address = doc.get_document("address").unwrap();
        assert_eq!(address.get_str("city").unwrap(), "Hanoi");
        assert_eq!(address.get_i64("zip").unwrap(), 100000);
    }

    #[test]
    fn unflatten_row_rebuilds_a_three_level_dotted_path() {
        let doc = unflatten_row(
            &["a.b.c".into()],
            &["42".into()],
            &opts(true, true),
        );
        let a = doc.get_document("a").unwrap();
        let b = a.get_document("b").unwrap();
        assert_eq!(b.get_i64("c").unwrap(), 42);
    }

    #[test]
    fn unflatten_row_keeps_two_sibling_dotted_paths_under_the_same_parent() {
        let doc = unflatten_row(
            &["a.b.c".into(), "a.b.d".into(), "a.e".into()],
            &["1".into(), "2".into(), "3".into()],
            &opts(true, true),
        );
        let a = doc.get_document("a").unwrap();
        assert_eq!(a.get_document("b").unwrap().get_i64("c").unwrap(), 1);
        assert_eq!(a.get_document("b").unwrap().get_i64("d").unwrap(), 2);
        assert_eq!(a.get_i64("e").unwrap(), 3);
    }

    #[test]
    fn unflatten_row_reconstructs_a_json_shaped_cell_into_nested_bson_under_a_dotted_path() {
        // A cell's own text can independently be JSON-like — this must compose with the
        // dotted-path rebuild, not just the scalar/JSON split (row_to_document in sql_import.rs
        // already covers the JSON-cell case in isolation; this proves the two features combine).
        let doc = unflatten_row(
            &["meta.tags".into()],
            &[r#"["a","b"]"#.into()],
            &opts(true, true),
        );
        let meta = doc.get_document("meta").unwrap();
        assert_eq!(meta.get_array("tags").unwrap().len(), 2);
    }

    #[test]
    fn unflatten_row_infers_a_plain_numeric_column_as_int64() {
        let doc = unflatten_row(&["n".into()], &["7".into()], &opts(true, true));
        assert_eq!(doc.get_i64("n").unwrap(), 7);
    }

    #[test]
    fn unflatten_row_leaves_cells_as_strings_when_both_infer_flags_are_off() {
        let doc = unflatten_row(&["n".into()], &["7".into()], &opts(false, false));
        assert_eq!(doc.get_str("n").unwrap(), "7");
    }

    fn preview(csv_text: &str, delimiter: CsvDelimiter, o: &InferOptions) -> Vec<CsvColumnPreview> {
        preview_columns(csv_text.as_bytes(), delimiter, 30, o).unwrap()
    }

    #[test]
    fn preview_columns_reports_header_inferred_type_and_samples() {
        let cols = preview("id,name\n1,Ada\n2,Grace\n", CsvDelimiter::Comma, &opts(true, true));
        assert_eq!(cols[0].path, "id");
        assert_eq!(cols[0].inferred_type, "int");
        assert_eq!(cols[0].samples, vec!["1".to_string(), "2".to_string()]);
        assert_eq!(cols[1].path, "name");
        assert_eq!(cols[1].inferred_type, "string");
    }

    #[test]
    fn preview_columns_respects_the_chosen_delimiter() {
        let cols = preview("id;name\n1;Ada\n", CsvDelimiter::Semicolon, &opts(true, true));
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].path, "id");
        assert_eq!(cols[1].path, "name");
    }

    #[test]
    fn preview_columns_reads_tab_delimited_files() {
        let cols = preview("id\tname\n1\tAda\n", CsvDelimiter::Tab, &opts(true, true));
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].samples, vec!["1".to_string()]);
    }

    #[test]
    fn preview_columns_marks_a_column_mixed_when_sampled_rows_disagree_on_type() {
        let cols = preview("n\n1\nhello\n", CsvDelimiter::Comma, &opts(true, true));
        assert_eq!(cols[0].inferred_type, "mixed");
    }

    #[test]
    fn preview_columns_reports_empty_for_a_column_with_no_data_rows() {
        let cols = preview("n\n", CsvDelimiter::Comma, &opts(true, true));
        assert_eq!(cols[0].inferred_type, "empty");
    }

    #[test]
    fn preview_columns_stops_scanning_at_max_rows() {
        // Rows 0-4 are ints; row 5 is a non-numeric sentinel. With max_rows=5, only rows 0-4
        // are examined, so the column's inferred type must stay "int" — if the scan continued
        // past the bound, row 5 would flip it to "mixed".
        let mut csv_text = String::from("n\n1\n2\n3\n4\n5\nboom\n");
        for i in 6..100 {
            csv_text.push_str(&format!("{i}\n"));
        }
        let cols = preview_columns(csv_text.as_bytes(), CsvDelimiter::Comma, 5, &opts(true, true)).unwrap();
        assert_eq!(cols[0].inferred_type, "int");
        assert_eq!(cols[0].samples.len(), 3); // still capped at 3 samples regardless of max_rows
    }

    #[test]
    fn preview_columns_bounds_the_scan_even_when_every_row_is_malformed() {
        // 10 consecutive malformed rows (wrong field count for the 2-column header), followed
        // by a well-formed row with a distinctive value. With max_rows=5, the malformed run
        // alone must exhaust the scan budget — the well-formed row must never be reached.
        let mut csv_text = String::from("a,b\n");
        for _ in 0..10 {
            csv_text.push_str("only_one_field\n");
        }
        csv_text.push_str("distinct_a,distinct_b\n");
        let cols = preview_columns(csv_text.as_bytes(), CsvDelimiter::Comma, 5, &opts(true, true)).unwrap();
        assert!(cols[0].samples.is_empty());
        assert!(!cols[0].samples.contains(&"distinct_a".to_string()));
    }

    #[test]
    fn preview_columns_skips_a_malformed_row_without_stopping_the_scan() {
        // Row 2 ("3") has one field where the header declares two — reported as unequal lengths
        // by the csv crate; the scan must still pick up row 3's values afterward.
        let cols = preview_columns("a,b\n1,2\n3\n4,5\n".as_bytes(), CsvDelimiter::Comma, 30, &opts(true, true)).unwrap();
        assert_eq!(cols[0].samples, vec!["1".to_string(), "4".to_string()]);
        assert_eq!(cols[1].samples, vec!["2".to_string(), "5".to_string()]);
    }

    fn rows(csv_text: &str, o: &InferOptions) -> Vec<CsvRow> {
        let (headers, mut reader) = open_reader(csv_text.as_bytes(), CsvDelimiter::Comma).unwrap();
        reader.records().enumerate().map(|(i, r)| convert_record(i, r, &headers, o)).collect()
    }

    #[test]
    fn convert_record_produces_a_doc_for_a_well_formed_row() {
        let out = rows("id,name\n1,Ada\n", &opts(true, true));
        match &out[0] {
            CsvRow::Doc(row_no, doc) => {
                assert_eq!(*row_no, 0);
                assert_eq!(doc.get_i64("id").unwrap(), 1);
                assert_eq!(doc.get_str("name").unwrap(), "Ada");
            }
            other => panic!("expected Doc, got {other:?}"),
        }
    }

    #[test]
    fn convert_record_reports_a_parse_error_for_a_ragged_row_and_keeps_reading() {
        let out = rows("a,b\n1,2\n3\n4,5\n", &opts(true, true));
        assert_eq!(out.len(), 3);
        assert!(matches!(&out[0], CsvRow::Doc(0, _)));
        assert!(matches!(&out[1], CsvRow::ParseError(1, _)));
        // the reader recovers and keeps reading — row 2 (the 3rd physical line) still parses.
        match &out[2] {
            CsvRow::Doc(row_no, doc) => {
                assert_eq!(*row_no, 2);
                assert_eq!(doc.get_i64("a").unwrap(), 4);
                assert_eq!(doc.get_i64("b").unwrap(), 5);
            }
            other => panic!("expected Doc, got {other:?}"),
        }
    }

    #[test]
    fn count_csv_rows_counts_every_data_row_including_a_malformed_one() {
        // Matches convert_record's row numbering: a malformed row is still one "row" toward the
        // progress total, since it will be attempted (and reported as an error) during commit.
        let n = count_csv_rows("a,b\n1,2\n3\n4,5\n".as_bytes(), CsvDelimiter::Comma).unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn count_csv_rows_is_zero_for_a_header_only_file() {
        let n = count_csv_rows("a,b\n".as_bytes(), CsvDelimiter::Comma).unwrap();
        assert_eq!(n, 0);
    }
}
