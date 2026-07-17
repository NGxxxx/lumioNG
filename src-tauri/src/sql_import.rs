//! Parse a generic SQL dump (`CREATE TABLE` + `INSERT INTO`) into per-table documents. Value
//! types come from each literal's own kind, not the declared column type — sidesteps modeling
//! every SQL dialect's type vocabulary, so any dump (MySQL, Postgres, ...) can be imported.
use crate::value_infer::{infer_bson, InferOptions};
use mongodb::bson::{Bson, Document};
use sqlparser::ast::{Expr, Insert, ObjectName, SetExpr, Statement, UnaryOperator, Value as SqlValue};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::HashMap;

/// Parses a SQL dump into its statement list — the one place `sqlparser` runs. The full dump's
/// AST is held in memory at once (`sqlparser` needs the whole source text up front); this is an
/// accepted limit for SQL dumps, which are not typically multi-GB unlike arbitrary file imports.
pub fn parse_statements(sql: &str) -> Result<Vec<Statement>, String> {
    let dialect = GenericDialect {};
    Parser::parse_sql(&dialect, sql).map_err(|e| e.to_string())
}

/// The table segment of a possibly schema-qualified identifier (`public.movie` -> `movie`) — Mongo
/// collections are flat. Uses each `Ident`'s `.value` (not `ObjectName`'s `Display`, which
/// re-emits the original quote character for a quoted identifier — `CREATE TABLE "movie"` would
/// otherwise round-trip to a collection literally named `"movie"`, quotes included).
pub fn table_ident(name: &ObjectName) -> String {
    name.0.last().map(|ident| ident.value.clone()).unwrap_or_default()
}

/// Only the `CREATE TABLE`-declared column lists, keyed by table name. Doesn't look at any
/// `INSERT` — a table introduced only by an `INSERT` with an explicit column list has no entry
/// here (see `resolve_insert_columns`, which handles that case using the `INSERT`'s own columns).
pub fn table_columns(statements: &[Statement]) -> HashMap<String, Vec<String>> {
    let mut m = HashMap::new();
    for stmt in statements {
        if let Statement::CreateTable(ct) = stmt {
            let name = table_ident(&ct.name);
            let cols: Vec<String> = ct.columns.iter().map(|c| c.name.value.clone()).collect();
            m.insert(name, cols);
        }
    }
    m
}

/// The column order to use for one `INSERT`'s rows: its own explicit `(col, col, ...)` list if
/// given, otherwise the table's `CREATE TABLE` column order. Empty means "unknown" — the row can't
/// be placed into fields and should be skipped (an `INSERT` with no column list into a table this
/// dump never declared via `CREATE TABLE`).
pub fn resolve_insert_columns(insert: &Insert, columns_by_table: &HashMap<String, Vec<String>>) -> Vec<String> {
    let explicit: Vec<String> = insert.columns.iter().map(|c| c.value.clone()).collect();
    if !explicit.is_empty() {
        return explicit;
    }
    columns_by_table
        .get(&table_ident(&insert.table_name))
        .cloned()
        .unwrap_or_default()
}

/// The raw `VALUES (...)` row expressions of one `INSERT INTO ... VALUES ...` statement, or `None`
/// for anything else (`INSERT ... SELECT`, unsupported — not a literal-values insert).
pub fn insert_values_rows(insert: &Insert) -> Option<&Vec<Vec<Expr>>> {
    let source = insert.source.as_ref()?;
    match source.body.as_ref() {
        SetExpr::Values(values) => Some(&values.rows),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableSchema {
    pub name: String,
    pub columns: Vec<String>,
    pub row_count: u64,
}

/// Structural pass over a parsed dump: each table's column list and row count, without converting
/// a single literal to `Bson` — used by the preview command (report a huge dump's row counts
/// instantly) and by the commit command (resolve `is_single_table_dump` and progress totals before
/// any row conversion runs). A table with no resolvable column order (see `resolve_insert_columns`)
/// contributes no rows and, if it also has no `CREATE TABLE`, doesn't appear at all.
pub fn table_schemas(statements: &[Statement]) -> Vec<TableSchema> {
    let columns_by_table = table_columns(statements);
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, u64> = HashMap::new();

    for stmt in statements {
        match stmt {
            Statement::CreateTable(ct) => {
                let name = table_ident(&ct.name);
                if !order.contains(&name) {
                    order.push(name);
                }
            }
            Statement::Insert(insert) => {
                let table = table_ident(&insert.table_name);
                if resolve_insert_columns(insert, &columns_by_table).is_empty() {
                    continue;
                }
                if !order.contains(&table) {
                    order.push(table.clone());
                }
                if let Some(rows) = insert_values_rows(insert) {
                    *counts.entry(table).or_insert(0) += rows.len() as u64;
                }
            }
            _ => {}
        }
    }

    order
        .into_iter()
        .map(|name| TableSchema {
            columns: columns_by_table.get(&name).cloned().unwrap_or_default(),
            row_count: *counts.get(&name).unwrap_or(&0),
            name,
        })
        .collect()
}

fn value_to_bson(v: &SqlValue, opts: &InferOptions) -> Bson {
    match v {
        SqlValue::Number(n, _) => {
            if let Ok(i) = n.parse::<i64>() {
                Bson::Int64(i)
            } else if let Ok(f) = n.parse::<f64>() {
                Bson::Double(f)
            } else {
                Bson::Null
            }
        }
        // Every SQL string literal is run through `value_infer` instead of always becoming
        // `Bson::String` — recovers nested objects/arrays and scalar types a dump quoted as text.
        SqlValue::SingleQuotedString(s) | SqlValue::DoubleQuotedString(s) => infer_bson(s, opts),
        SqlValue::Boolean(b) => Bson::Boolean(*b),
        SqlValue::Null => Bson::Null,
        _ => Bson::Null,
    }
}

/// Best-effort literal-only conversion; anything else (subqueries, function calls) becomes `null`.
fn expr_to_bson(expr: &Expr, opts: &InferOptions) -> Bson {
    match expr {
        Expr::Value(v) => value_to_bson(v, opts),
        Expr::UnaryOp { op, expr } if matches!(op, UnaryOperator::Minus) => match expr_to_bson(expr, opts) {
            Bson::Int64(n) => Bson::Int64(-n),
            Bson::Double(n) => Bson::Double(-n),
            other => other,
        },
        _ => Bson::Null,
    }
}

/// Converts one `INSERT` row's literal expressions into a document, zipping each value against
/// `cols` in order (extra values beyond `cols.len()`, or missing ones, are silently dropped —
/// matches a malformed row rather than erroring the whole import over it).
pub fn row_to_document(cols: &[String], row: &[Expr], opts: &InferOptions) -> Document {
    let mut d = Document::new();
    for (col, expr) in cols.iter().zip(row.iter()) {
        d.insert(col.clone(), expr_to_bson(expr, opts));
    }
    d
}

/// Decides which collection one table's rows should land in: when the whole dump has exactly one
/// table (`is_single_table_dump`) and the caller pre-selected a destination (`target_coll`,
/// typically the collection the Import dialog was opened from), insert there regardless of the
/// table's own name. A multi-table dump always keeps its own one-collection-per-table names —
/// there's no way to know which table the pre-selected collection was meant for.
pub fn resolve_target_collection(table_name: &str, is_single_table_dump: bool, target_coll: Option<&str>) -> String {
    match (is_single_table_dump, target_coll) {
        (true, Some(t)) => t.to_string(),
        _ => table_name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_ident_strips_the_quote_character_from_a_quoted_table_name() {
        let statements = parse_statements(r#"CREATE TABLE "movie" (id INT);"#).unwrap();
        let Statement::CreateTable(ct) = &statements[0] else { panic!("expected CreateTable") };
        assert_eq!(table_ident(&ct.name), "movie");
    }

    #[test]
    fn table_ident_leaves_an_unquoted_table_name_unchanged() {
        let statements = parse_statements("CREATE TABLE movie (id INT);").unwrap();
        let Statement::CreateTable(ct) = &statements[0] else { panic!("expected CreateTable") };
        assert_eq!(table_ident(&ct.name), "movie");
    }

    #[test]
    fn table_ident_collapses_a_schema_qualified_name_to_the_table_segment() {
        // Mongo collections are flat — `public.movie` has no schema concept to preserve.
        let statements = parse_statements("CREATE TABLE public.movie (id INT);").unwrap();
        let Statement::CreateTable(ct) = &statements[0] else { panic!("expected CreateTable") };
        assert_eq!(table_ident(&ct.name), "movie");
    }

    #[test]
    fn table_ident_on_a_quoted_insert_into_table_name() {
        let statements = parse_statements(r#"INSERT INTO "orders" (id) VALUES (1);"#).unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        assert_eq!(table_ident(&insert.table_name), "orders");
    }

    #[test]
    fn parse_statements_rejects_malformed_sql_as_an_error_not_a_panic() {
        assert!(parse_statements("CREATE TABLE (((").is_err());
    }

    #[test]
    fn table_schemas_lists_columns_and_row_counts_per_table_in_first_seen_order() {
        let sql = r#"
            CREATE TABLE users (id INT, name TEXT);
            CREATE TABLE orders (id INT, total INT);
            INSERT INTO users VALUES (1, 'Ada');
            INSERT INTO orders VALUES (1, 100);
            INSERT INTO orders VALUES (2, 200);
        "#;
        let statements = parse_statements(sql).unwrap();
        let schemas = table_schemas(&statements);
        assert_eq!(
            schemas.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["users", "orders"]
        );
        assert_eq!(schemas[0].columns, vec!["id", "name"]);
        assert_eq!(schemas[0].row_count, 1);
        assert_eq!(schemas[1].row_count, 2);
    }

    #[test]
    fn table_schemas_counts_rows_without_needing_a_convertible_expression() {
        // NOW() is a function call — `expr_to_bson` would map it to `Bson::Null` rather than
        // erroring, but the point here is `table_schemas` never looks at the expression's kind at
        // all, only the tuple count, so it can't depend on conversion succeeding.
        let sql = "CREATE TABLE t (a TIMESTAMP); INSERT INTO t VALUES (NOW());";
        let statements = parse_statements(sql).unwrap();
        let schemas = table_schemas(&statements);
        assert_eq!(schemas[0].row_count, 1);
    }

    #[test]
    fn table_schemas_reports_zero_rows_for_a_create_table_with_no_insert() {
        let statements = parse_statements("CREATE TABLE empty_t (a INT);").unwrap();
        let schemas = table_schemas(&statements);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].row_count, 0);
    }

    #[test]
    fn table_schemas_skips_an_insert_with_no_columns_and_no_known_create_table() {
        let statements = parse_statements("INSERT INTO ghost VALUES (1, 2);").unwrap();
        let schemas = table_schemas(&statements);
        assert!(schemas.is_empty());
    }

    #[test]
    fn resolve_insert_columns_prefers_the_explicit_column_list_over_create_table_order() {
        let statements =
            parse_statements("CREATE TABLE t (a INT, b INT); INSERT INTO t (b, a) VALUES (2, 1);")
                .unwrap();
        let columns_by_table = table_columns(&statements);
        let Statement::Insert(insert) = &statements[1] else { panic!("expected Insert") };
        assert_eq!(resolve_insert_columns(insert, &columns_by_table), vec!["b", "a"]);
    }

    #[test]
    fn resolve_insert_columns_falls_back_to_create_table_order_with_no_explicit_list() {
        let statements =
            parse_statements("CREATE TABLE t (a INT, b INT); INSERT INTO t VALUES (1, 2);").unwrap();
        let columns_by_table = table_columns(&statements);
        let Statement::Insert(insert) = &statements[1] else { panic!("expected Insert") };
        assert_eq!(resolve_insert_columns(insert, &columns_by_table), vec!["a", "b"]);
    }

    #[test]
    fn insert_values_rows_returns_none_for_a_non_values_insert() {
        let statements = parse_statements("INSERT INTO t SELECT * FROM other;").unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        assert!(insert_values_rows(insert).is_none());
    }

    #[test]
    fn row_to_document_converts_literals_by_position() {
        let statements = parse_statements("INSERT INTO t VALUES (1, 'Ada', TRUE);").unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        let rows = insert_values_rows(insert).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let doc = row_to_document(&["id".into(), "name".into(), "active".into()], &rows[0], &opts);
        assert_eq!(doc.get_i64("id").unwrap(), 1);
        assert_eq!(doc.get_str("name").unwrap(), "Ada");
        assert_eq!(doc.get_bool("active").unwrap(), true);
    }

    #[test]
    fn row_to_document_handles_negative_numbers_null_and_float_literals() {
        let statements = parse_statements("INSERT INTO t VALUES (-5, 3.14, NULL);").unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        let rows = insert_values_rows(insert).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let doc = row_to_document(&["a".into(), "b".into(), "c".into()], &rows[0], &opts);
        assert_eq!(doc.get_i64("a").unwrap(), -5);
        assert_eq!(doc.get_f64("b").unwrap(), 3.14);
        assert_eq!(doc.get("c").unwrap(), &Bson::Null);
    }

    #[test]
    fn row_to_document_reconstructs_a_json_shaped_string_literal_into_nested_bson() {
        // A SQL string literal containing Canonical Extended JSON text (what `toSql` already
        // writes for nested fields on export) round-trips back into a real nested document.
        let sql = r#"INSERT INTO t VALUES ('{"city":"Hanoi","zip":100000}');"#;
        let statements = parse_statements(sql).unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        let rows = insert_values_rows(insert).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let doc = row_to_document(&["address".into()], &rows[0], &opts);
        let nested = doc.get_document("address").unwrap();
        assert_eq!(nested.get_str("city").unwrap(), "Hanoi");
        assert_eq!(nested.get_i32("zip").unwrap(), 100000);
    }

    #[test]
    fn row_to_document_infers_a_quoted_numeric_string_literal_as_int64_when_scalars_are_on() {
        // SQL dumps quote every value regardless of type; scalar inference recovers the original
        // type instead of leaving everything as `Bson::String` (this is the slice's core fix).
        let statements = parse_statements("INSERT INTO t VALUES ('42');").unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        let rows = insert_values_rows(insert).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let doc = row_to_document(&["n".into()], &rows[0], &opts);
        assert_eq!(doc.get_i64("n").unwrap(), 42);
    }

    #[test]
    fn row_to_document_leaves_a_quoted_string_literal_as_a_string_when_infer_options_are_off() {
        let statements = parse_statements("INSERT INTO t VALUES ('42');").unwrap();
        let Statement::Insert(insert) = &statements[0] else { panic!("expected Insert") };
        let rows = insert_values_rows(insert).unwrap();
        let opts = InferOptions { parse_json_like: false, infer_scalars: false };
        let doc = row_to_document(&["n".into()], &rows[0], &opts);
        assert_eq!(doc.get_str("n").unwrap(), "42");
    }

    #[test]
    fn resolve_target_collection_uses_the_target_only_for_a_single_table_dump() {
        assert_eq!(resolve_target_collection("movie", true, Some("films")), "films");
        assert_eq!(resolve_target_collection("movie", false, Some("films")), "movie");
        assert_eq!(resolve_target_collection("movie", true, None), "movie");
    }
}
