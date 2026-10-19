//! Pure JSON/JSONL import helpers: parse one line/element, count and detect the file shape without
//! materializing documents. Streaming glue lives in `commands/import_export.rs`.
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc;
use mongodb::bson::Document;

/// Parses one JSONL line, or `None` if the line is blank (skipped, not counted as a document).
pub(crate) fn parse_jsonl_line(line: &str) -> Option<Result<Document, String>> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(canonical_string_to_doc(trimmed).map_err(|e| e.to_string()))
    }
}

/// Parses one JSON-array element's raw text (kept separate from `parse_jsonl_line` for call-site clarity).
pub(crate) fn parse_array_element(text: &str) -> Result<Document, String> {
    canonical_string_to_doc(text).map_err(|e| e.to_string())
}

/// Counts non-blank lines without parsing them -- mirrors `count_array_elements`/`count_csv_rows`
/// avoiding document conversion during the count pass.
pub(crate) fn count_jsonl_lines<R: std::io::BufRead>(reader: R) -> Result<u64, AppError> {
    let mut n = 0u64;
    for line in reader.lines() {
        let line = line.map_err(|e| AppError::Io(e.to_string()))?;
        if !line.trim().is_empty() {
            n += 1;
        }
    }
    Ok(n)
}

/// Peeks the first non-whitespace byte to choose the JSON-array vs. JSONL producer; an empty file is treated as JSONL.
pub(crate) fn detect_json_array(path: &str) -> Result<bool, AppError> {
    use std::io::BufRead as _;
    let file = std::fs::File::open(path).map_err(|e| AppError::Io(e.to_string()))?;
    let mut reader = std::io::BufReader::new(file);
    loop {
        let buf = reader.fill_buf().map_err(|e| AppError::Io(e.to_string()))?;
        let Some(&b) = buf.first() else {
            return Ok(false);
        };
        if b == b' ' || b == b'\t' || b == b'\n' || b == b'\r' {
            reader.consume(1);
            continue;
        }
        return Ok(b == b'[');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_jsonl_line_skips_blank_and_whitespace_only_lines() {
        assert!(parse_jsonl_line("").is_none());
        assert!(parse_jsonl_line("   ").is_none());
    }

    #[test]
    fn parse_jsonl_line_parses_a_valid_document() {
        let doc = parse_jsonl_line(r#"{"a":1}"#).unwrap().unwrap();
        // Plain JSON integers that fit i32 parse to Bson::Int32, not Int64.
        assert_eq!(doc.get_i32("a").unwrap(), 1);
    }

    #[test]
    fn parse_jsonl_line_reports_a_parse_error_for_invalid_json() {
        assert!(parse_jsonl_line("not json").unwrap().is_err());
    }

    #[test]
    fn count_jsonl_lines_counts_non_blank_lines_only() {
        let n = count_jsonl_lines(std::io::Cursor::new(b"{\"a\":1}\n\n{\"b\":2}\n" as &[u8])).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn count_jsonl_lines_is_zero_for_an_empty_file() {
        let n = count_jsonl_lines(std::io::Cursor::new(b"" as &[u8])).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn detect_json_array_is_true_for_a_leading_bracket_with_whitespace() {
        let dir = std::env::temp_dir().join("lumiong_test_detect_array");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.json");
        std::fs::write(&path, "  \n[{\"a\":1}]").unwrap();
        assert!(detect_json_array(path.to_str().unwrap()).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_json_array_is_false_for_jsonl() {
        let dir = std::env::temp_dir().join("lumiong_test_detect_jsonl");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.jsonl");
        std::fs::write(&path, "{\"a\":1}\n{\"b\":2}\n").unwrap();
        assert!(!detect_json_array(path.to_str().unwrap()).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_json_array_is_false_for_an_empty_file() {
        let dir = std::env::temp_dir().join("lumiong_test_detect_empty");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.json");
        std::fs::write(&path, "").unwrap();
        assert!(!detect_json_array(path.to_str().unwrap()).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_syntactically_invalid_but_balanced_array_element_fails_to_parse_while_its_neighbors_do_not() {
        // The scanner still yields all three elements; only the malformed one fails to parse (the array isn't rejected as a whole).
        let json = r#"[{"a":1},{"a": tru},{"b":2}]"#;
        let mut r = crate::json_stream::ArrayElementReader::new(std::io::Cursor::new(json.as_bytes())).unwrap();
        let mut results = Vec::new();
        while let Some(text) = r.next_element().unwrap() {
            results.push(parse_array_element(&text));
        }
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert!(results[2].is_ok());
    }
}
