//! Streaming scanner for a top-level JSON array's elements. `ArrayElementReader` finds each
//! element's raw text by tracking `{}[]` nesting depth and string/escape state — it does not
//! validate JSON grammar beyond that, so a syntactically-broken element that still balances
//! braces/quotes is still yielded as one element (the caller's JSON parser rejects it later;
//! see the design doc's "Behavior change" section). Byte-level comparisons against ASCII
//! structural bytes (`{}[]",\`) are UTF-8-safe: those bytes can never appear as a continuation
//! byte of a multi-byte UTF-8 sequence (which always has the high bit set), so scanning raw
//! bytes never splits a multi-byte character.
use std::io::BufRead;

fn peek_byte<R: BufRead>(r: &mut R) -> Result<Option<u8>, String> {
    let buf = r.fill_buf().map_err(|e| e.to_string())?;
    Ok(buf.first().copied())
}

fn read_byte<R: BufRead>(r: &mut R) -> Result<Option<u8>, String> {
    match peek_byte(r)? {
        Some(b) => {
            r.consume(1);
            Ok(Some(b))
        }
        None => Ok(None),
    }
}

fn skip_ws<R: BufRead>(r: &mut R) -> Result<(), String> {
    loop {
        match peek_byte(r)? {
            Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r') => {
                r.consume(1);
            }
            _ => return Ok(()),
        }
    }
}

/// Reads one array element's raw text at a time. Constructed positioned right after the
/// opening `[`; `next_element` returns `None` once the closing `]` is consumed.
pub struct ArrayElementReader<R> {
    reader: R,
    done: bool,
}

impl<R: BufRead> ArrayElementReader<R> {
    /// Consumes leading whitespace and the opening `[`. Errors if the first non-whitespace
    /// byte isn't `[`, or the file is empty.
    pub fn new(mut reader: R) -> Result<Self, String> {
        skip_ws(&mut reader)?;
        match read_byte(&mut reader)? {
            Some(b'[') => Ok(Self { reader, done: false }),
            Some(other) => Err(format!(
                "expected '[' at start of JSON array, found '{}'",
                other as char
            )),
            None => Err("empty file, expected a JSON array".to_string()),
        }
    }

    /// Reads the next element's raw text, or `None` once `]` is reached. Does not validate
    /// JSON grammar inside an element — see module docs.
    pub fn next_element(&mut self) -> Result<Option<String>, String> {
        if self.done {
            return Ok(None);
        }
        skip_ws(&mut self.reader)?;
        match peek_byte(&mut self.reader)? {
            Some(b']') => {
                read_byte(&mut self.reader)?;
                self.done = true;
                Ok(None)
            }
            None => Err("unexpected EOF, expected ']' or an array element".to_string()),
            Some(_) => {
                let text = self.scan_one_element()?;
                skip_ws(&mut self.reader)?;
                match peek_byte(&mut self.reader)? {
                    Some(b',') => {
                        read_byte(&mut self.reader)?;
                    }
                    Some(b']') => {}
                    Some(other) => {
                        return Err(format!(
                            "expected ',' or ']' after array element, found '{}'",
                            other as char
                        ))
                    }
                    None => {
                        return Err(
                            "unexpected EOF after array element, expected ',' or ']'".to_string()
                        )
                    }
                }
                Ok(Some(text))
            }
        }
    }

    fn scan_one_element(&mut self) -> Result<String, String> {
        let mut depth: i32 = 0;
        let mut in_string = false;
        let mut escaped = false;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let b = match peek_byte(&mut self.reader)? {
                Some(b) => b,
                None => return Err("unexpected EOF inside array element".to_string()),
            };
            if !in_string && depth == 0 && (b == b',' || b == b']') {
                // Only strips interstitial JSON whitespace between a value and its `,`/`]` --
                // never string-internal content, since a string only ever exits `in_string` on
                // its closing quote, which is always the last byte pushed before this point.
                let text = String::from_utf8_lossy(&out).into_owned();
                return Ok(text.trim_end().to_string());
            }
            read_byte(&mut self.reader)?;
            out.push(b);
            if in_string {
                if escaped {
                    escaped = false;
                } else if b == b'\\' {
                    escaped = true;
                } else if b == b'"' {
                    in_string = false;
                }
            } else {
                match b {
                    b'"' => in_string = true,
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => depth -= 1,
                    _ => {}
                }
            }
        }
    }
}

/// Counts top-level elements without retaining any element's text past its own scan —
/// drives the same `next_element` scan step as `ArrayElementReader` so the count can never
/// drift from what the reader actually yields.
pub fn count_array_elements<R: BufRead>(reader: R) -> Result<u64, String> {
    let mut r = ArrayElementReader::new(reader)?;
    let mut n = 0u64;
    while r.next_element()?.is_some() {
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn elements(json: &str) -> Result<Vec<String>, String> {
        let mut r = ArrayElementReader::new(Cursor::new(json.as_bytes()))?;
        let mut out = Vec::new();
        while let Some(e) = r.next_element()? {
            out.push(e);
        }
        Ok(out)
    }

    #[test]
    fn yields_elements_in_order() {
        let out = elements(r#"[{"a":1},{"b":2}]"#).unwrap();
        assert_eq!(out, vec!["{\"a\":1}".to_string(), "{\"b\":2}".to_string()]);
    }

    #[test]
    fn empty_array_yields_zero_elements() {
        assert_eq!(elements("[]").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn whitespace_between_elements_is_not_part_of_any_elements_text() {
        let out = elements("[ {\"a\":1} ,\n {\"b\":2} ]").unwrap();
        assert_eq!(out, vec!["{\"a\":1}".to_string(), "{\"b\":2}".to_string()]);
    }

    #[test]
    fn a_string_containing_structural_characters_does_not_confuse_depth_tracking() {
        // The string itself contains a comma, a bracket, and a brace — none of them may end
        // the element or the array early.
        let out = elements(r#"["a,b]{"]"#).unwrap();
        assert_eq!(out, vec![r#""a,b]{""#.to_string()]);
    }

    #[test]
    fn an_escaped_quote_inside_a_string_does_not_end_the_string_early() {
        let out = elements(r#"["a\"b"]"#).unwrap();
        assert_eq!(out, vec![r#""a\"b""#.to_string()]);
    }

    #[test]
    fn truncated_array_missing_the_closing_bracket_errors() {
        assert!(elements(r#"[{"a":1}"#).is_err());
    }

    #[test]
    fn a_syntactically_invalid_but_brace_balanced_element_is_still_yielded() {
        // The scanner only tracks brace balance, not JSON grammar -- `tru` (not `true`) still
        // yields as one element; whether it *parses* is the caller's problem (see Task 3).
        let out = elements(r#"[{"a":1},{"a": tru},{"b":2}]"#).unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[1], r#"{"a": tru}"#);
    }

    #[test]
    fn count_array_elements_agrees_with_the_reader_on_the_same_fixture() {
        let json = r#"[{"a":1},{"b":2},{"c":3}]"#;
        let count = count_array_elements(Cursor::new(json.as_bytes())).unwrap();
        assert_eq!(count, elements(json).unwrap().len() as u64);
    }

    #[test]
    fn count_array_elements_is_zero_for_an_empty_array() {
        assert_eq!(count_array_elements(Cursor::new(b"[]" as &[u8])).unwrap(), 0);
    }

    #[test]
    fn a_string_value_ending_in_whitespace_keeps_its_trailing_whitespace() {
        // trim_end() only strips whitespace *after* a value's closing structural byte -- a
        // string's own trailing whitespace sits inside the quotes, before that closing `"`, so
        // it must survive.
        let out = elements(r#"["hello "]"#).unwrap();
        assert_eq!(out, vec![r#""hello ""#.to_string()]);
    }
}
