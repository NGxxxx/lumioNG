//! Parses a generic SQL dump (`CREATE TABLE` + `INSERT INTO`) into per-table documents; value
//! types come from each literal's own kind, not the declared column type.
use crate::value_infer::{bson_type_name, infer_bson, InferOptions};
use mongodb::bson::{Bson, Document};
use sqlparser::ast::{Expr, Insert, ObjectName, SetExpr, Statement, UnaryOperator, Value as SqlValue};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::{HashMap, HashSet};

/// Parses one statement's raw text into a single `Statement` — the only place `sqlparser` runs in production.
pub fn parse_one_statement(text: &str) -> Result<Statement, String> {
    let dialect = GenericDialect {};
    let mut statements = Parser::parse_sql(&dialect, text).map_err(|e| e.to_string())?;
    if statements.is_empty() {
        return Err("statement text produced no parsed statement".to_string());
    }
    Ok(statements.remove(0))
}

/// The table segment of a possibly schema-qualified identifier (`public.movie` -> `movie`); Mongo collections are flat.
pub fn table_ident(name: &ObjectName) -> String {
    name.0.last().map(|ident| ident.value.clone()).unwrap_or_default()
}

/// The column order for one `INSERT`'s rows: its own explicit list if given, else the table's `CREATE TABLE` order; empty means skip.
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
    /// Per-column inferred type label, aligned with `columns`; empty when built with `sample_types: false`.
    pub column_types: Vec<String>,
}

/// Rows sampled per table when inferring column types for the preview — deliberately small; the
/// picker's type annotation doesn't need every row, just a representative sample.
const SQL_COLUMN_TYPE_SAMPLE_ROWS: usize = 10;

/// Folds one dump's statements into per-table schema (and, optionally, column-type samples) one statement at a time —
/// streaming, so the whole parsed `Vec<Statement>` never needs to be resident.
pub struct SqlSchemaAccumulator {
    sample_types: bool,
    opts: InferOptions,
    columns_by_table: HashMap<String, Vec<String>>,
    order: Vec<String>,
    counts: HashMap<String, u64>,
    sampled_tables: HashSet<String>,
    types_by_table: HashMap<String, HashMap<String, HashSet<&'static str>>>,
}

impl SqlSchemaAccumulator {
    /// `sample_types`: `true` for the preview (needs type inference), `false` for commit's cheap totals-only pass.
    pub fn new(sample_types: bool, opts: InferOptions) -> Self {
        Self {
            sample_types,
            opts,
            columns_by_table: HashMap::new(),
            order: Vec::new(),
            counts: HashMap::new(),
            sampled_tables: HashSet::new(),
            types_by_table: HashMap::new(),
        }
    }

    pub fn add_statement(&mut self, stmt: &Statement) {
        match stmt {
            Statement::CreateTable(ct) => {
                let name = table_ident(&ct.name);
                if !self.order.contains(&name) {
                    self.order.push(name.clone());
                }
                let cols: Vec<String> = ct.columns.iter().map(|c| c.name.value.clone()).collect();
                self.columns_by_table.insert(name, cols);
            }
            Statement::Insert(insert) => {
                let table = table_ident(&insert.table_name);
                let cols = resolve_insert_columns(insert, &self.columns_by_table);
                if cols.is_empty() {
                    return;
                }
                if !self.order.contains(&table) {
                    self.order.push(table.clone());
                }
                let Some(rows) = insert_values_rows(insert) else { return };
                *self.counts.entry(table.clone()).or_insert(0) += rows.len() as u64;

                if self.sample_types && self.sampled_tables.insert(table.clone()) {
                    let type_map = self.types_by_table.entry(table).or_default();
                    for row in rows.iter().take(SQL_COLUMN_TYPE_SAMPLE_ROWS) {
                        for (col, expr) in cols.iter().zip(row.iter()) {
                            type_map
                                .entry(col.clone())
                                .or_default()
                                .insert(bson_type_name(&expr_to_bson(expr, &self.opts)));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// Consumes the accumulator into each table's schema (first-seen order) plus `columns_by_table`, for the commit pass to reuse.
    pub fn finish(self) -> (Vec<TableSchema>, HashMap<String, Vec<String>>) {
        let schemas = self
            .order
            .iter()
            .map(|name| {
                let columns = self.columns_by_table.get(name).cloned().unwrap_or_default();
                let column_types = if self.sample_types {
                    let types = self.types_by_table.get(name);
                    columns
                        .iter()
                        .map(|c| match types.and_then(|t| t.get(c)) {
                            None => "empty".to_string(),
                            Some(set) if set.len() == 1 => set.iter().next().unwrap().to_string(),
                            Some(_) => "mixed".to_string(),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                TableSchema {
                    name: name.clone(),
                    row_count: *self.counts.get(name).unwrap_or(&0),
                    columns,
                    column_types,
                }
            })
            .collect();
        (schemas, self.columns_by_table)
    }
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

/// Converts one `INSERT` row's literals into a document, zipping against `cols` (extra/missing values are silently dropped).
pub fn row_to_document(cols: &[String], row: &[Expr], opts: &InferOptions) -> Document {
    let mut d = Document::new();
    for (col, expr) in cols.iter().zip(row.iter()) {
        d.insert(col.clone(), expr_to_bson(expr, opts));
    }
    d
}

/// Decides the target collection: a caller-supplied `target_coll` takes every table's rows (the
/// frontend's explicit "insert everything into this existing collection" choice); with none, each
/// table keeps its own name (one new collection per table).
pub fn resolve_target_collection(table_name: &str, target_coll: Option<&str>) -> String {
    target_coll.map(str::to_string).unwrap_or_else(|| table_name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test-only multi-statement fixture builder (whole-string parse); production parses one statement at a time via `sql_stream`.
    fn parse_statements(sql: &str) -> Result<Vec<Statement>, String> {
        let dialect = GenericDialect {};
        Parser::parse_sql(&dialect, sql).map_err(|e| e.to_string())
    }

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
    fn parse_one_statement_parses_a_single_create_table_statement() {
        let stmt = parse_one_statement("CREATE TABLE t (a INT)").unwrap();
        assert!(matches!(stmt, Statement::CreateTable(_)));
    }

    #[test]
    fn parse_one_statement_parses_a_single_insert_statement() {
        let stmt = parse_one_statement("INSERT INTO t VALUES (1)").unwrap();
        assert!(matches!(stmt, Statement::Insert(_)));
    }

    #[test]
    fn parse_one_statement_rejects_malformed_sql_as_an_error_not_a_panic() {
        assert!(parse_one_statement("CREATE TABLE (((").is_err());
    }

    fn accumulate(sql: &str, sample_types: bool, opts: InferOptions) -> (Vec<TableSchema>, HashMap<String, Vec<String>>) {
        let statements = parse_statements(sql).unwrap();
        let mut acc = SqlSchemaAccumulator::new(sample_types, opts);
        for stmt in &statements {
            acc.add_statement(stmt);
        }
        acc.finish()
    }

    #[test]
    fn accumulator_lists_columns_and_row_counts_per_table_in_first_seen_order() {
        let sql = r#"
            CREATE TABLE users (id INT, name TEXT);
            CREATE TABLE orders (id INT, total INT);
            INSERT INTO users VALUES (1, 'Ada');
            INSERT INTO orders VALUES (1, 100);
            INSERT INTO orders VALUES (2, 200);
        "#;
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, false, opts);
        assert_eq!(
            schemas.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            vec!["users", "orders"]
        );
        assert_eq!(schemas[0].columns, vec!["id", "name"]);
        assert_eq!(schemas[0].row_count, 1);
        assert_eq!(schemas[1].row_count, 2);
    }

    #[test]
    fn accumulator_counts_rows_without_needing_a_convertible_expression() {
        // NOW() maps to Bson::Null, but row counting only counts tuples, not conversion success.
        let sql = "CREATE TABLE t (a TIMESTAMP); INSERT INTO t VALUES (NOW());";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, false, opts);
        assert_eq!(schemas[0].row_count, 1);
    }

    #[test]
    fn accumulator_reports_zero_rows_for_a_create_table_with_no_insert() {
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate("CREATE TABLE empty_t (a INT);", false, opts);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].row_count, 0);
    }

    #[test]
    fn accumulator_skips_an_insert_with_no_columns_and_no_known_create_table() {
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate("INSERT INTO ghost VALUES (1, 2);", false, opts);
        assert!(schemas.is_empty());
    }

    #[test]
    fn accumulator_skips_an_implicit_column_insert_that_appears_before_its_create_table() {
        // Single forward pass: real dump tools emit CREATE TABLE before INSERT, so out-of-order INSERTs just go uncounted.
        let sql = "INSERT INTO t VALUES (1, 2); CREATE TABLE t (a INT, b INT);";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, false, opts);
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].row_count, 0);
    }

    #[test]
    fn accumulator_carries_columns_by_table_into_finish_for_the_commit_pass_to_reuse() {
        let sql = "CREATE TABLE t (a INT, b INT); INSERT INTO t VALUES (1, 2);";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (_, columns_by_table) = accumulate(sql, false, opts);
        assert_eq!(columns_by_table.get("t").unwrap(), &vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn resolve_insert_columns_prefers_the_explicit_column_list_over_create_table_order() {
        let sql = "CREATE TABLE t (a INT, b INT); INSERT INTO t (b, a) VALUES (2, 1);";
        let statements = parse_statements(sql).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (_, columns_by_table) = accumulate(sql, false, opts);
        let Statement::Insert(insert) = &statements[1] else { panic!("expected Insert") };
        assert_eq!(resolve_insert_columns(insert, &columns_by_table), vec!["b", "a"]);
    }

    #[test]
    fn resolve_insert_columns_falls_back_to_create_table_order_with_no_explicit_list() {
        let sql = "CREATE TABLE t (a INT, b INT); INSERT INTO t VALUES (1, 2);";
        let statements = parse_statements(sql).unwrap();
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (_, columns_by_table) = accumulate(sql, false, opts);
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
    fn resolve_target_collection_uses_the_explicit_target_for_every_table_when_given() {
        assert_eq!(resolve_target_collection("movie", Some("films")), "films");
        assert_eq!(resolve_target_collection("orders", Some("films")), "films");
        assert_eq!(resolve_target_collection("movie", None), "movie");
    }

    #[test]
    fn accumulator_infers_a_uniform_int_column_when_sampling_is_on() {
        let sql = "CREATE TABLE t (a INT, b INT); INSERT INTO t VALUES (1, 2), (3, 4);";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, true, opts);
        assert_eq!(schemas[0].column_types, vec!["int".to_string(), "int".to_string()]);
    }

    #[test]
    fn accumulator_reports_mixed_when_sampled_rows_disagree() {
        let sql = "CREATE TABLE t (a TEXT); INSERT INTO t VALUES (1), ('hello');";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, true, opts);
        assert_eq!(schemas[0].column_types, vec!["mixed".to_string()]);
    }

    #[test]
    fn accumulator_reports_empty_for_a_table_with_no_insert_when_sampling_is_on() {
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate("CREATE TABLE t (a INT, b INT);", true, opts);
        assert_eq!(schemas[0].column_types, vec!["empty".to_string(), "empty".to_string()]);
    }

    #[test]
    fn accumulator_only_samples_the_first_matching_insert() {
        // The second INSERT would flip column "a" to "mixed" if it were sampled — it must not be.
        // Row counting is unaffected by the sampling toggle: both inserts still count.
        let sql = "CREATE TABLE t (a INT); INSERT INTO t VALUES (1), (2); INSERT INTO t VALUES ('not a number');";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, true, opts);
        assert_eq!(schemas[0].column_types, vec!["int".to_string()]);
        assert_eq!(schemas[0].row_count, 3);
    }

    #[test]
    fn accumulator_respects_explicit_out_of_order_insert_columns_when_sampling() {
        // INSERT explicitly lists (b, a) — types must attribute by column name, not position.
        let sql = "CREATE TABLE t (a INT, b TEXT); INSERT INTO t (b, a) VALUES ('x', 1);";
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(sql, true, opts);
        assert_eq!(schemas[0].column_types, vec!["int".to_string(), "string".to_string()]);
    }

    #[test]
    fn accumulator_stops_sampling_at_the_row_cap() {
        // 10 int rows then a string row — with the cap at 10, the string row must not be sampled.
        let mut sql = String::from("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ");
        let rows: Vec<String> = (0..10).map(|i| format!("({i})")).collect();
        sql.push_str(&rows.join(", "));
        sql.push_str(", ('boom');");
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let (schemas, _) = accumulate(&sql, true, opts);
        assert_eq!(schemas[0].column_types, vec!["int".to_string()]);
    }

    #[test]
    fn end_to_end_streaming_scan_parse_and_accumulate_over_a_dump_with_comments_and_quoted_semicolons() {
        use crate::sql_stream::SqlStatementReader;
        use std::io::Cursor;

        let sql = "-- dump start\n\
                   CREATE TABLE users (id INT, note TEXT);\n\
                   /*!40000 ALTER TABLE users DISABLE KEYS */;\n\
                   INSERT INTO users VALUES (1, 'semicolon; inside a string'), (2, 'it''s escaped');\n\
                   -- dump end\n";
        let mut scanner = SqlStatementReader::new(Cursor::new(sql.as_bytes()));
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let mut acc = SqlSchemaAccumulator::new(true, opts);
        let mut statement_texts = Vec::new();
        while let Some(text) = scanner.next_statement().unwrap() {
            statement_texts.push(text.clone());
            if let Ok(stmt) = parse_one_statement(&text) {
                acc.add_statement(&stmt);
            }
        }
        // The `/*!40000 ... */` line is a block comment followed by a bare `;` — the scanner
        // swallows both without yielding an empty statement, so only 2 statements reach the parser.
        assert_eq!(statement_texts.len(), 2);
        let (schemas, _) = acc.finish();
        assert_eq!(schemas.len(), 1);
        assert_eq!(schemas[0].row_count, 2);
        assert_eq!(schemas[0].column_types, vec!["int".to_string(), "string".to_string()]);
    }
}
