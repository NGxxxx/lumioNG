//! CSV formatting for streaming collection export -- a Rust port of `domain/exporter.ts`'s `toCsv`, folding one document at a time.
use crate::bson_json::describe_bson;
use mongodb::bson::{Bson, Document};
use std::collections::HashSet;
use std::io::{self, Write};

/// Tracks every leaf dot-path seen across a stream of documents, in first-seen order; recurses into a non-empty nested
/// `Bson::Document` only (an empty document or any array is always a leaf).
#[derive(Default)]
pub struct ColumnAccumulator {
    seen: HashSet<String>,
    order: Vec<String>,
}

impl ColumnAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, doc: &Document) {
        self.walk(doc, "");
    }

    fn walk(&mut self, doc: &Document, prefix: &str) {
        for (k, v) in doc.iter() {
            let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
            match v {
                Bson::Document(inner) if !inner.is_empty() => self.walk(inner, &path),
                _ => {
                    if self.seen.insert(path.clone()) {
                        self.order.push(path);
                    }
                }
            }
        }
    }

    /// Finalizes into the column list, `_id` promoted to the front when present.
    pub fn into_columns(self) -> Vec<String> {
        let mut order = self.order;
        if let Some(idx) = order.iter().position(|p| p == "_id") {
            if idx > 0 {
                let id = order.remove(idx);
                order.insert(0, id);
            }
        }
        order
    }
}

/// Reads a value at a dot-path, recursing into nested documents only (CSV column paths are always object-key chains, never array indices).
fn get_leaf<'a>(doc: &'a Document, path: &str) -> Option<&'a Bson> {
    let mut segments = path.split('.');
    let mut cur = doc.get(segments.next()?)?;
    for seg in segments {
        cur = cur.as_document()?.get(seg)?;
    }
    Some(cur)
}

/// Escapes one CSV field: wraps in quotes and doubles inner quotes when it contains `,`, `"`,
/// `\n`, or `\r` -- port of `escapeCsv`.
pub fn escape_csv(field: &str) -> String {
    if field.contains(['"', ',', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Raw (unescaped) cell text for one CSV value; a missing field is `""`, nested object/array use `describe_bson`'s full JSON text.
fn csv_cell(v: Option<&Bson>) -> String {
    v.map(|b| describe_bson(b).1).unwrap_or_default()
}

/// Writes the header line, no leading separator -- the first line of the `[header,
/// ...rows].join("\n")`-shaped output `toCsv` produces.
pub fn write_header<W: Write>(w: &mut W, columns: &[String]) -> io::Result<()> {
    let line = columns.iter().map(|c| escape_csv(c)).collect::<Vec<_>>().join(",");
    w.write_all(line.as_bytes())
}

/// Writes one data row, preceded by `\n`; a `columns` entry with no matching path in `doc` renders as an empty cell.
pub fn write_row<W: Write>(w: &mut W, columns: &[String], doc: &Document) -> io::Result<()> {
    w.write_all(b"\n")?;
    let line = columns
        .iter()
        .map(|c| escape_csv(&csv_cell(get_leaf(doc, c))))
        .collect::<Vec<_>>()
        .join(",");
    w.write_all(line.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn escape_csv_leaves_plain_text_untouched() {
        assert_eq!(escape_csv("hello"), "hello");
    }

    #[test]
    fn escape_csv_quotes_when_comma_present() {
        assert_eq!(escape_csv("a,b"), "\"a,b\"");
    }

    #[test]
    fn escape_csv_quotes_and_doubles_inner_quotes() {
        assert_eq!(escape_csv("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn escape_csv_quotes_when_newline_present() {
        assert_eq!(escape_csv("a\nb"), "\"a\nb\"");
    }

    #[test]
    fn column_accumulator_orders_by_first_seen_with_id_promoted() {
        let mut acc = ColumnAccumulator::new();
        acc.observe(&doc! { "name": "x", "_id": "a" });
        acc.observe(&doc! { "age": 3i32 });
        assert_eq!(acc.into_columns(), vec!["_id", "name", "age"]);
    }

    #[test]
    fn column_accumulator_recurses_into_non_empty_nested_documents_only() {
        let mut acc = ColumnAccumulator::new();
        acc.observe(&doc! { "p": { "city": "Hanoi" }, "empty": {}, "tags": ["a", "b"] });
        // "p" recurses to "p.city"; "empty" (an empty document) and "tags" (an array) are leaves.
        assert_eq!(acc.into_columns(), vec!["p.city", "empty", "tags"]);
    }

    #[test]
    fn csv_cell_missing_field_is_empty() {
        let doc = doc! { "a": 1i32 };
        assert_eq!(csv_cell(get_leaf(&doc, "missing")), "");
    }

    #[test]
    fn csv_cell_nested_object_and_array_are_full_json_text() {
        let doc = doc! { "o": { "a": 1i32 }, "arr": [1i32, 2i32] };
        assert_eq!(csv_cell(get_leaf(&doc, "o")), "{\"a\":{\"$numberInt\":\"1\"}}");
        assert_eq!(csv_cell(get_leaf(&doc, "arr")), "[{\"$numberInt\":\"1\"},{\"$numberInt\":\"2\"}]");
    }

    // Golden byte-for-byte fixture, copied verbatim from `exporter.test.ts`'s
    // "header is union of leaf paths with _id first; missing -> empty cell" case.
    #[test]
    #[allow(non_snake_case)] // name embeds `toCsv` on purpose, for traceability to exporter.test.ts's fixture
    fn golden_csv_matches_toCsv_fixture() {
        let doc1 = doc! { "_id": "a", "name": "x" };
        let doc2 = doc! { "_id": "b", "age": 3i32 };
        let mut acc = ColumnAccumulator::new();
        acc.observe(&doc1);
        acc.observe(&doc2);
        let columns = acc.into_columns();
        assert_eq!(columns, vec!["_id", "name", "age"]);

        let mut buf: Vec<u8> = Vec::new();
        write_header(&mut buf, &columns).unwrap();
        write_row(&mut buf, &columns, &doc1).unwrap();
        write_row(&mut buf, &columns, &doc2).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "_id,name,age\na,x,\nb,,3");
    }

    #[test]
    fn golden_csv_nested_doc_dot_path_column() {
        // From exporter.test.ts's "nested doc -> dot-path column" case.
        let doc = doc! { "_id": "a", "p": { "city": "Hanoi" } };
        let mut acc = ColumnAccumulator::new();
        acc.observe(&doc);
        let columns = acc.into_columns();
        assert_eq!(columns, vec!["_id", "p.city"]);

        let mut buf: Vec<u8> = Vec::new();
        write_header(&mut buf, &columns).unwrap();
        write_row(&mut buf, &columns, &doc).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "_id,p.city\na,Hanoi");
    }

    #[test]
    fn write_row_drops_a_field_not_in_the_fixed_column_list() {
        // Simulates schema drift: an extra field not in the header must be silently dropped, not shift other columns.
        let mut acc = ColumnAccumulator::new();
        acc.observe(&doc! { "_id": "a", "name": "x" });
        let columns = acc.into_columns();

        let drifted = doc! { "_id": "b", "name": "y", "age": 3i32 };
        let mut buf: Vec<u8> = Vec::new();
        write_row(&mut buf, &columns, &drifted).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "\nb,y");
    }
}
