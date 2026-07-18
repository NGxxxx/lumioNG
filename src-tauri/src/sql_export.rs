//! SQL dump formatting for streaming collection export -- a Rust port of `domain/exporter.ts`'s
//! `toSql` (`topLevelColumns`/`sqlColumnTypes`/`quoteIdent`/`escapeSqlString`/`sqlLiteral`).
//! Column discovery and per-column type flags are combined into one accumulator pass (unlike
//! `exporter.ts`, which conveniently walks its in-memory `Doc[]` twice) since a Mongo cursor can
//! only be walked once per export pass.
use crate::bson_json::describe_bson;
use mongodb::bson::{Bson, Document};
use std::collections::{HashMap, HashSet};
use std::io::{self, Write};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlColType {
    Integer,
    Real,
    Boolean,
    Text,
}

impl SqlColType {
    fn as_sql(self) -> &'static str {
        match self {
            SqlColType::Integer => "INTEGER",
            SqlColType::Real => "REAL",
            SqlColType::Boolean => "BOOLEAN",
            SqlColType::Text => "TEXT",
        }
    }
}

#[derive(Default, Clone, Copy)]
struct TypeFlags {
    number: bool,
    bool_: bool,
    other: bool,
    float: bool,
}

impl TypeFlags {
    /// Port of `sqlColumnTypes`'s ternary decision table: any non-number/bool value, or a column
    /// that mixes numbers and booleans, is TEXT; else bool wins over number; a number column is
    /// REAL only if a float-typed value was ever seen, else INTEGER.
    fn finalize(self) -> SqlColType {
        if self.other || (self.number && self.bool_) {
            SqlColType::Text
        } else if self.bool_ {
            SqlColType::Boolean
        } else if self.number {
            if self.float { SqlColType::Real } else { SqlColType::Integer }
        } else {
            SqlColType::Text
        }
    }
}

/// Tracks top-level field names (order + type flags) across a stream of documents -- the
/// streaming equivalent of `topLevelColumns` + `sqlColumnTypes`.
#[derive(Default)]
pub struct SqlSchemaAccumulator {
    seen: HashSet<String>,
    order: Vec<String>,
    flags: HashMap<String, TypeFlags>,
}

impl SqlSchemaAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, doc: &Document) {
        for (k, v) in doc.iter() {
            if self.seen.insert(k.clone()) {
                self.order.push(k.clone());
                self.flags.insert(k.clone(), TypeFlags::default());
            }
            if matches!(v, Bson::Null) {
                continue;
            }
            let f = self.flags.get_mut(k).expect("just inserted above");
            match v {
                Bson::Boolean(_) => f.bool_ = true,
                Bson::Int32(_) | Bson::Int64(_) => f.number = true,
                Bson::Double(_) | Bson::Decimal128(_) => {
                    f.number = true;
                    f.float = true;
                }
                _ => f.other = true,
            }
        }
    }

    /// Finalizes into the column list (`_id` promoted to front) and each column's `SqlColType`.
    pub fn finish(self) -> (Vec<String>, HashMap<String, SqlColType>) {
        let mut order = self.order;
        if let Some(idx) = order.iter().position(|p| p == "_id") {
            if idx > 0 {
                let id = order.remove(idx);
                order.insert(0, id);
            }
        }
        let types = self.flags.into_iter().map(|(k, f)| (k, f.finalize())).collect();
        (order, types)
    }
}

/// Quotes a SQL identifier (table/column name) -- port of `quoteIdent`.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Escapes a single-quoted SQL string literal's body -- port of `escapeSqlString`.
pub fn escape_sql_string(s: &str) -> String {
    s.replace('\'', "''")
}

/// `s` matches `^-?\d+(\.\d+)?$` -- port of `sqlLiteral`'s defensive regex guard. Mostly matters
/// for Decimal128: unlike int32/int64 (whose canonical digit string is always plain digits), a
/// `$numberDecimal` value can textually be `"NaN"`/`"Infinity"`/exponential notation.
fn is_clean_signed_decimal(s: &str) -> bool {
    let body = s.strip_prefix('-').unwrap_or(s);
    match body.split_once('.') {
        None => !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()),
        Some((int_part, frac_part)) => {
            !int_part.is_empty()
                && !frac_part.is_empty()
                && int_part.bytes().all(|b| b.is_ascii_digit())
                && frac_part.bytes().all(|b| b.is_ascii_digit())
        }
    }
}

/// Formats a finite f64 the way JS's `String(number)` would for typical application-data
/// magnitudes -- matches Rust's shortest-round-trip `{}` Display, which agrees with JS's
/// algorithm outside JS's exponential-notation range (|x| >= 1e21 or 0 < |x| < 1e-6, not
/// reproduced here; not a realistic magnitude for real collection data). `-0.0` is normalized to
/// `"0"` since Rust's Display keeps the sign of negative zero but JS's `String(-0)` does not.
fn format_js_double(f: f64) -> String {
    if f == 0.0 {
        "0".to_string()
    } else {
        format!("{f}")
    }
}

/// SQL literal for one cell -- port of `sqlLiteral`. `None`/`Null` -> `NULL`; boolean -> `TRUE`/
/// `FALSE`; a finite double -> JS-`String()`-formatted (bypassing `describe_bson`'s canonical
/// text, which forces a trailing ".0" that `sqlLiteral`'s own `Number()`/`String()` round-trip
/// would strip); int/long/decimal -> the exact digit string via `describe_bson` if it looks
/// clean, else `NULL`; everything else (string/objectId/date/object/array) -> a quoted, escaped
/// display string.
pub fn sql_literal(v: Option<&Bson>) -> String {
    match v {
        None | Some(Bson::Null) => "NULL".to_string(),
        Some(Bson::Boolean(b)) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Some(Bson::Double(f)) => {
            if f.is_finite() { format_js_double(*f) } else { "NULL".to_string() }
        }
        Some(b @ (Bson::Int32(_) | Bson::Int64(_) | Bson::Decimal128(_))) => {
            let (_, display) = describe_bson(b);
            if is_clean_signed_decimal(&display) { display } else { "NULL".to_string() }
        }
        Some(b) => {
            let (_, display) = describe_bson(b);
            format!("'{}'", escape_sql_string(&display))
        }
    }
}

/// Writes `CREATE TABLE ... (...);` plus the blank-line separator before the INSERT section --
/// port of `toSql`'s `create` text plus the `""` element in `[create, "", ...inserts].join("\n")`.
pub fn write_create_table<W: Write>(
    w: &mut W,
    table: &str,
    columns: &[String],
    types: &HashMap<String, SqlColType>,
) -> io::Result<()> {
    let table_q = quote_ident(table);
    let create_cols = columns
        .iter()
        .map(|c| {
            let ty = types.get(c).copied().unwrap_or(SqlColType::Text).as_sql();
            format!("  {} {ty}", quote_ident(c))
        })
        .collect::<Vec<_>>()
        .join(",\n");
    write!(w, "CREATE TABLE {table_q} (\n{create_cols}\n);\n\n")
}

/// Writes one `INSERT INTO ... VALUES (...);` line, preceded by `\n` unless `first`. Combined
/// with `write_create_table`, N calls reproduce `[create, "", ...inserts].join("\n")` byte-for-
/// byte. A `columns` entry missing from `doc` (schema drift between the export's two passes, or
/// simply an optional field) renders as `NULL`.
pub fn write_insert<W: Write>(
    w: &mut W,
    table: &str,
    columns: &[String],
    doc: &Document,
    first: bool,
) -> io::Result<()> {
    if !first {
        w.write_all(b"\n")?;
    }
    let table_q = quote_ident(table);
    let col_list = columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
    let values = columns.iter().map(|c| sql_literal(doc.get(c))).collect::<Vec<_>>().join(", ");
    write!(w, "INSERT INTO {table_q} ({col_list}) VALUES ({values});")
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn quote_ident_wraps_and_escapes_inner_quotes() {
        assert_eq!(quote_ident("users"), "\"users\"");
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn escape_sql_string_doubles_embedded_single_quotes() {
        assert_eq!(escape_sql_string("O'Brien"), "O''Brien");
        assert_eq!(escape_sql_string("hello"), "hello");
    }

    #[test]
    fn sql_literal_null_and_missing() {
        assert_eq!(sql_literal(None), "NULL");
        assert_eq!(sql_literal(Some(&Bson::Null)), "NULL");
    }

    #[test]
    fn sql_literal_boolean() {
        assert_eq!(sql_literal(Some(&Bson::Boolean(true))), "TRUE");
        assert_eq!(sql_literal(Some(&Bson::Boolean(false))), "FALSE");
    }

    #[test]
    fn sql_literal_numeric_wrapper_is_bare_digits() {
        assert_eq!(sql_literal(Some(&Bson::Int32(5))), "5");
        assert_eq!(sql_literal(Some(&Bson::Double(3.14))), "3.14");
    }

    #[test]
    fn sql_literal_whole_number_double_has_no_trailing_dot_zero() {
        // Unlike `describe_bson`'s canonical text (which forces "2.0"), sqlLiteral round-trips
        // through JS Number()/String() semantics and drops the trailing ".0" -- ported here via
        // Rust's own f64 Display, which agrees with JS in this range.
        assert_eq!(sql_literal(Some(&Bson::Double(2.0))), "2");
    }

    #[test]
    fn sql_literal_non_finite_double_is_null() {
        assert_eq!(sql_literal(Some(&Bson::Double(f64::NAN))), "NULL");
        assert_eq!(sql_literal(Some(&Bson::Double(f64::INFINITY))), "NULL");
    }

    #[test]
    fn sql_literal_long_and_decimal_outside_safe_integer_range_keep_exact_digits() {
        assert_eq!(sql_literal(Some(&Bson::Int64(9_223_372_036_854_775_807))), "9223372036854775807");
        use mongodb::bson::Decimal128;
        use std::str::FromStr;
        let d = Decimal128::from_str("123456789012345678901234.5").unwrap();
        assert_eq!(sql_literal(Some(&Bson::Decimal128(d))), "123456789012345678901234.5");
    }

    #[test]
    fn sql_literal_string_is_quoted_and_escaped() {
        assert_eq!(sql_literal(Some(&Bson::String("O'Brien".into()))), "'O''Brien'");
    }

    #[test]
    fn sql_literal_object_and_array_are_quoted_full_json_text() {
        assert_eq!(sql_literal(Some(&Bson::Document(doc! { "a": 1i32 }))), "'{\"a\":{\"$numberInt\":\"1\"}}'");
        assert_eq!(sql_literal(Some(&Bson::Array(vec![Bson::Int32(1)]))), "'[{\"$numberInt\":\"1\"}]'");
    }

    #[test]
    fn sql_schema_accumulator_orders_columns_with_id_promoted() {
        let mut acc = SqlSchemaAccumulator::new();
        acc.observe(&doc! { "name": "x", "_id": "a" });
        let (columns, _) = acc.finish();
        assert_eq!(columns, vec!["_id", "name"]);
    }

    #[test]
    fn sql_schema_accumulator_mixed_number_and_non_number_is_text() {
        let mut acc = SqlSchemaAccumulator::new();
        acc.observe(&doc! { "_id": 1i32, "v": 5i32 });
        acc.observe(&doc! { "_id": 2i32, "v": "x" });
        let (_, types) = acc.finish();
        assert_eq!(types["v"], SqlColType::Text);
    }

    #[test]
    fn sql_schema_accumulator_float_only_is_real_int_only_is_integer() {
        let mut floats = SqlSchemaAccumulator::new();
        floats.observe(&doc! { "_id": 1i32, "v": 1.5 });
        assert_eq!(floats.finish().1["v"], SqlColType::Real);

        let mut ints = SqlSchemaAccumulator::new();
        ints.observe(&doc! { "_id": 1i32, "v": 5i32 });
        assert_eq!(ints.finish().1["v"], SqlColType::Integer);
    }

    #[test]
    fn sql_schema_accumulator_bool_only_is_boolean_nulls_dont_count() {
        let mut acc = SqlSchemaAccumulator::new();
        acc.observe(&doc! { "_id": 1i32, "v": true });
        acc.observe(&doc! { "_id": 2i32, "v": Bson::Null });
        assert_eq!(acc.finish().1["v"], SqlColType::Boolean);
    }

    #[test]
    fn sql_schema_accumulator_nested_object_stays_one_text_column_not_flattened() {
        let mut acc = SqlSchemaAccumulator::new();
        acc.observe(&doc! { "_id": 1i32, "address": { "city": "Hanoi" }, "tags": ["a", "b"] });
        let (columns, types) = acc.finish();
        assert!(columns.contains(&"address".to_string()));
        assert!(!columns.iter().any(|c| c.contains("address.city")));
        assert_eq!(types["address"], SqlColType::Text);
        assert_eq!(types["tags"], SqlColType::Text);
    }

    // Golden byte-for-byte fixture, copied verbatim from `exporter.test.ts`'s "creates a table
    // with _id first and inserts one row per doc" case.
    #[test]
    #[allow(non_snake_case)] // name embeds `toSql` on purpose, for traceability to exporter.test.ts's fixture
    fn golden_sql_matches_toSql_fixture() {
        let doc1 = doc! { "_id": "a", "name": "Ada", "age": 30i32, "active": true };
        let mut acc = SqlSchemaAccumulator::new();
        acc.observe(&doc1);
        let (columns, types) = acc.finish();
        assert_eq!(columns, vec!["_id", "name", "age", "active"]);

        let mut buf: Vec<u8> = Vec::new();
        write_create_table(&mut buf, "users", &columns, &types).unwrap();
        write_insert(&mut buf, "users", &columns, &doc1, true).unwrap();
        let expected = "CREATE TABLE \"users\" (\n  \"_id\" TEXT,\n  \"name\" TEXT,\n  \"age\" INTEGER,\n  \"active\" BOOLEAN\n);\n\nINSERT INTO \"users\" (\"_id\", \"name\", \"age\", \"active\") VALUES ('a', 'Ada', 30, TRUE);";
        assert_eq!(String::from_utf8(buf).unwrap(), expected);
    }

    #[test]
    fn write_insert_second_row_is_prefixed_by_a_single_newline() {
        let doc1 = doc! { "_id": 1i32 };
        let doc2 = doc! { "_id": 2i32 };
        let columns = vec!["_id".to_string()];
        let mut buf: Vec<u8> = Vec::new();
        write_insert(&mut buf, "t", &columns, &doc1, true).unwrap();
        write_insert(&mut buf, "t", &columns, &doc2, false).unwrap();
        assert_eq!(
            String::from_utf8(buf).unwrap(),
            "INSERT INTO \"t\" (\"_id\") VALUES (1);\nINSERT INTO \"t\" (\"_id\") VALUES (2);"
        );
    }

    #[test]
    fn write_insert_drops_a_field_not_in_the_fixed_column_list() {
        // Schema drift: pass 1 only saw "_id"; pass 2's document has an extra "name" field.
        let columns = vec!["_id".to_string()];
        let drifted = doc! { "_id": 1i32, "name": "x" };
        let mut buf: Vec<u8> = Vec::new();
        write_insert(&mut buf, "t", &columns, &drifted, true).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "INSERT INTO \"t\" (\"_id\") VALUES (1);");
    }

    #[test]
    fn write_insert_missing_column_in_this_doc_is_null() {
        let columns = vec!["_id".to_string(), "name".to_string()];
        let partial = doc! { "_id": 1i32 };
        let mut buf: Vec<u8> = Vec::new();
        write_insert(&mut buf, "t", &columns, &partial, true).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "INSERT INTO \"t\" (\"_id\", \"name\") VALUES (1, NULL);");
    }
}
