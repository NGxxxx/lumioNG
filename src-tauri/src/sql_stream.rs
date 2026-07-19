//! Streaming scanner for a SQL dump's statement boundaries. `SqlStatementReader` yields one
//! top-level statement's raw text (the unit `sqlparser::Parser::parse_sql` expects) at a time by
//! tracking quoted-string/identifier spans and comments — it does not validate SQL grammar beyond
//! that, so a syntactically-invalid statement that still balances quotes/comments is still yielded
//! as one unit (the caller's `sqlparser` call rejects it later). Byte-level comparisons against
//! ASCII structural bytes (`;'"``, `-`, `/`, `*`) are UTF-8-safe: those bytes can never appear as
//! a continuation byte of a multi-byte UTF-8 sequence (which always has the high bit set), so
//! scanning raw bytes never splits a multi-byte character.
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

fn finish_text(out: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(out).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Reads one SQL statement's raw text at a time. Constructed positioned at the start of the
/// stream; `next_statement` returns `None` once EOF is reached with nothing left to yield.
pub struct SqlStatementReader<R> {
    reader: R,
    done: bool,
}

impl<R: BufRead> SqlStatementReader<R> {
    pub fn new(reader: R) -> Self {
        Self { reader, done: false }
    }

    /// Returns the next statement's raw text (trailing `;` excluded, leading/trailing whitespace
    /// trimmed), or `None` at EOF. A statement with no trailing `;` right before EOF is still
    /// yielded once, leniently. A comment/whitespace-only region (including a fully empty or
    /// comment-only file, or a run of consecutive `;;`) contributes no statement and is skipped.
    pub fn next_statement(&mut self) -> Result<Option<String>, String> {
        if self.done {
            return Ok(None);
        }
        let mut out: Vec<u8> = Vec::new();
        let mut quote: Option<u8> = None;
        loop {
            let Some(b) = peek_byte(&mut self.reader)? else {
                self.done = true;
                if quote.is_some() {
                    return Err("unterminated quoted string or identifier at end of file".to_string());
                }
                return Ok(finish_text(&out));
            };

            if let Some(q) = quote {
                read_byte(&mut self.reader)?;
                out.push(b);
                if b == q {
                    if peek_byte(&mut self.reader)? == Some(q) {
                        read_byte(&mut self.reader)?;
                        out.push(q);
                    } else {
                        quote = None;
                    }
                }
                continue;
            }

            match b {
                b'\'' | b'"' | b'`' => {
                    quote = Some(b);
                    read_byte(&mut self.reader)?;
                    out.push(b);
                }
                b'-' => {
                    read_byte(&mut self.reader)?;
                    if peek_byte(&mut self.reader)? == Some(b'-') {
                        read_byte(&mut self.reader)?;
                        self.skip_line_comment()?;
                    } else {
                        out.push(b'-');
                    }
                }
                b'/' => {
                    read_byte(&mut self.reader)?;
                    if peek_byte(&mut self.reader)? == Some(b'*') {
                        read_byte(&mut self.reader)?;
                        self.skip_block_comment()?;
                    } else {
                        out.push(b'/');
                    }
                }
                b';' => {
                    read_byte(&mut self.reader)?;
                    if let Some(text) = finish_text(&out) {
                        return Ok(Some(text));
                    }
                    out.clear();
                }
                _ => {
                    read_byte(&mut self.reader)?;
                    out.push(b);
                }
            }
        }
    }

    fn skip_line_comment(&mut self) -> Result<(), String> {
        loop {
            match read_byte(&mut self.reader)? {
                None | Some(b'\n') => return Ok(()),
                Some(_) => {}
            }
        }
    }

    fn skip_block_comment(&mut self) -> Result<(), String> {
        loop {
            match read_byte(&mut self.reader)? {
                None => return Err("unterminated block comment".to_string()),
                Some(b'*') => {
                    if peek_byte(&mut self.reader)? == Some(b'/') {
                        read_byte(&mut self.reader)?;
                        return Ok(());
                    }
                }
                Some(_) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn statements(sql: &str) -> Result<Vec<String>, String> {
        let mut r = SqlStatementReader::new(Cursor::new(sql.as_bytes()));
        let mut out = Vec::new();
        while let Some(s) = r.next_statement()? {
            out.push(s);
        }
        Ok(out)
    }

    #[test]
    fn yields_statements_split_on_top_level_semicolons() {
        let out = statements("CREATE TABLE t (a INT); INSERT INTO t VALUES (1);").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string(), "INSERT INTO t VALUES (1)".to_string()]);
    }

    #[test]
    fn empty_file_yields_zero_statements() {
        assert_eq!(statements("").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn a_single_quoted_string_containing_a_semicolon_does_not_split_the_statement() {
        let out = statements("INSERT INTO t VALUES ('a;b');").unwrap();
        assert_eq!(out, vec!["INSERT INTO t VALUES ('a;b')".to_string()]);
    }

    #[test]
    fn a_doubled_single_quote_inside_a_string_does_not_end_the_string_early() {
        let out = statements("INSERT INTO t VALUES ('it''s here; still one string');").unwrap();
        assert_eq!(out, vec!["INSERT INTO t VALUES ('it''s here; still one string')".to_string()]);
    }

    #[test]
    fn a_double_quoted_identifier_containing_a_semicolon_does_not_split_the_statement() {
        let out = statements(r#"SELECT "weird;name" FROM t;"#).unwrap();
        assert_eq!(out, vec![r#"SELECT "weird;name" FROM t"#.to_string()]);
    }

    #[test]
    fn a_backtick_quoted_identifier_containing_a_semicolon_does_not_split_the_statement() {
        let out = statements("SELECT `weird;name` FROM t;").unwrap();
        assert_eq!(out, vec!["SELECT `weird;name` FROM t".to_string()]);
    }

    #[test]
    fn a_doubled_backtick_inside_a_backtick_identifier_does_not_end_it_early() {
        let out = statements("SELECT `a``b` FROM t;").unwrap();
        assert_eq!(out, vec!["SELECT `a``b` FROM t".to_string()]);
    }

    #[test]
    fn a_line_comment_containing_a_semicolon_does_not_split_the_statement() {
        let out = statements("CREATE TABLE t (a INT); -- drop everything; seriously\nINSERT INTO t VALUES (1);").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string(), "INSERT INTO t VALUES (1)".to_string()]);
    }

    #[test]
    fn a_block_comment_containing_a_semicolon_does_not_split_the_statement() {
        let out = statements("CREATE TABLE t (a INT); /*!40000 DISABLE KEYS; RE-ENABLE LATER */ INSERT INTO t VALUES (1);").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string(), "INSERT INTO t VALUES (1)".to_string()]);
    }

    #[test]
    fn a_comment_only_file_yields_zero_statements() {
        assert_eq!(statements("-- just a comment\n/* and a block comment */\n").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn consecutive_semicolons_do_not_yield_an_empty_statement() {
        let out = statements("CREATE TABLE t (a INT);;INSERT INTO t VALUES (1);").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string(), "INSERT INTO t VALUES (1)".to_string()]);
    }

    #[test]
    fn a_final_statement_with_no_trailing_semicolon_is_still_yielded_once() {
        let out = statements("CREATE TABLE t (a INT); INSERT INTO t VALUES (1)").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string(), "INSERT INTO t VALUES (1)".to_string()]);
    }

    #[test]
    fn an_unterminated_quoted_string_at_eof_errors() {
        assert!(statements("INSERT INTO t VALUES ('unterminated").is_err());
    }

    #[test]
    fn a_minus_not_followed_by_another_minus_is_not_treated_as_a_comment() {
        let out = statements("INSERT INTO t VALUES (-5);").unwrap();
        assert_eq!(out, vec!["INSERT INTO t VALUES (-5)".to_string()]);
    }

    #[test]
    fn whitespace_around_statements_is_trimmed() {
        let out = statements("  \n  CREATE TABLE t (a INT)  ;  \n").unwrap();
        assert_eq!(out, vec!["CREATE TABLE t (a INT)".to_string()]);
    }
}
