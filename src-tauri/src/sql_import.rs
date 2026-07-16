//! Parse a generic SQL dump (`CREATE TABLE` + `INSERT INTO`) into per-table documents. Value
//! types come from each literal's own kind, not the declared column type — sidesteps modeling
//! every SQL dialect's type vocabulary, so any dump (MySQL, Postgres, ...) can be imported.
use mongodb::bson::{Bson, Document};
use sqlparser::ast::{Expr, SetExpr, Statement, UnaryOperator, Value as SqlValue};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct SqlTable {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Document>,
}

fn value_to_bson(v: &SqlValue) -> Bson {
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
        SqlValue::SingleQuotedString(s) | SqlValue::DoubleQuotedString(s) => Bson::String(s.clone()),
        SqlValue::Boolean(b) => Bson::Boolean(*b),
        SqlValue::Null => Bson::Null,
        _ => Bson::Null,
    }
}

/// Best-effort literal-only conversion; anything else (subqueries, function calls) becomes `null`.
fn expr_to_bson(expr: &Expr) -> Bson {
    match expr {
        Expr::Value(v) => value_to_bson(v),
        Expr::UnaryOp { op, expr } if matches!(op, UnaryOperator::Minus) => match expr_to_bson(expr) {
            Bson::Int64(n) => Bson::Int64(-n),
            Bson::Double(n) => Bson::Double(-n),
            other => other,
        },
        _ => Bson::Null,
    }
}

/// Parse a full SQL dump into per-table documents, in first-seen order. An `INSERT` with no
/// explicit column list falls back to its `CREATE TABLE`'s column order; with neither, it's skipped.
/// `only_tables`: when `Some`, skips converting rows for any other table (used by the commit
/// path once the user has picked which tables to import; `None` for the preview path).
pub fn parse_sql_dump(sql: &str, only_tables: Option<&HashSet<String>>) -> Result<Vec<SqlTable>, String> {
    let dialect = GenericDialect {};
    let statements = Parser::parse_sql(&dialect, sql).map_err(|e| e.to_string())?;

    let mut order: Vec<String> = Vec::new();
    let mut columns_by_table: HashMap<String, Vec<String>> = HashMap::new();
    let mut rows_by_table: HashMap<String, Vec<Document>> = HashMap::new();

    for stmt in &statements {
        match stmt {
            Statement::CreateTable(ct) => {
                let name = ct.name.to_string();
                let cols: Vec<String> = ct.columns.iter().map(|c| c.name.value.clone()).collect();
                if !columns_by_table.contains_key(&name) {
                    order.push(name.clone());
                }
                columns_by_table.insert(name.clone(), cols);
            }
            Statement::Insert(insert) => {
                let table = insert.table_name.to_string();
                if only_tables.is_some_and(|only| !only.contains(&table)) {
                    continue;
                }
                let explicit_cols: Vec<String> = insert.columns.iter().map(|c| c.value.clone()).collect();
                let cols = if !explicit_cols.is_empty() {
                    explicit_cols
                } else {
                    columns_by_table.get(&table).cloned().unwrap_or_default()
                };
                if cols.is_empty() {
                    continue;
                }
                if !rows_by_table.contains_key(&table) && !order.contains(&table) {
                    order.push(table.clone());
                }
                let entry = rows_by_table.entry(table).or_default();
                if let Some(source) = &insert.source {
                    if let SetExpr::Values(values) = source.body.as_ref() {
                        for row in &values.rows {
                            let mut d = Document::new();
                            for (col, expr) in cols.iter().zip(row.iter()) {
                                d.insert(col.clone(), expr_to_bson(expr));
                            }
                            entry.push(d);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(order
        .into_iter()
        .map(|name| SqlTable {
            columns: columns_by_table.get(&name).cloned().unwrap_or_default(),
            rows: rows_by_table.remove(&name).unwrap_or_default(),
            name,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_create_table_and_insert_into_documents() {
        let sql = r#"
            CREATE TABLE users (id INT, name TEXT, active BOOLEAN);
            INSERT INTO users VALUES (1, 'Ada', TRUE);
            INSERT INTO users VALUES (2, 'Bob', FALSE);
        "#;
        let tables = parse_sql_dump(sql, None).unwrap();
        assert_eq!(tables.len(), 1);
        let t = &tables[0];
        assert_eq!(t.name, "users");
        assert_eq!(t.columns, vec!["id", "name", "active"]);
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.rows[0].get_i64("id").unwrap(), 1);
        assert_eq!(t.rows[0].get_str("name").unwrap(), "Ada");
        assert_eq!(t.rows[0].get_bool("active").unwrap(), true);
        assert_eq!(t.rows[1].get_bool("active").unwrap(), false);
    }

    #[test]
    fn insert_with_explicit_column_list_ignores_declared_order() {
        let sql = r#"
            CREATE TABLE t (a INT, b INT);
            INSERT INTO t (b, a) VALUES (2, 1);
        "#;
        let tables = parse_sql_dump(sql, None).unwrap();
        let row = &tables[0].rows[0];
        assert_eq!(row.get_i64("a").unwrap(), 1);
        assert_eq!(row.get_i64("b").unwrap(), 2);
    }

    #[test]
    fn multiple_tables_are_kept_separate_and_ordered() {
        let sql = r#"
            CREATE TABLE a (x INT);
            CREATE TABLE b (y INT);
            INSERT INTO a VALUES (1);
            INSERT INTO b VALUES (2);
        "#;
        let tables = parse_sql_dump(sql, None).unwrap();
        assert_eq!(tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
    }

    #[test]
    fn negative_numbers_and_null_and_float_literals() {
        let sql = r#"
            CREATE TABLE t (a INT, b REAL, c TEXT);
            INSERT INTO t VALUES (-5, 3.14, NULL);
        "#;
        let tables = parse_sql_dump(sql, None).unwrap();
        let row = &tables[0].rows[0];
        assert_eq!(row.get_i64("a").unwrap(), -5);
        assert_eq!(row.get_f64("b").unwrap(), 3.14);
        assert_eq!(row.get("c").unwrap(), &Bson::Null);
    }

    #[test]
    fn insert_without_columns_or_known_create_table_is_skipped() {
        let sql = "INSERT INTO ghost VALUES (1, 2);";
        let tables = parse_sql_dump(sql, None).unwrap();
        assert!(tables.is_empty());
    }

    #[test]
    fn create_table_with_no_matching_insert_yields_an_empty_table() {
        let sql = "CREATE TABLE empty_t (a INT);";
        let tables = parse_sql_dump(sql, None).unwrap();
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].rows.len(), 0);
    }

    #[test]
    fn only_tables_filter_skips_rows_for_unselected_tables_entirely() {
        let sql = r#"
            CREATE TABLE a (x INT);
            CREATE TABLE b (y INT);
            INSERT INTO a VALUES (1);
            INSERT INTO b VALUES (2);
        "#;
        let only: HashSet<String> = ["a".to_string()].into_iter().collect();
        let tables = parse_sql_dump(sql, Some(&only)).unwrap();
        // Table "b"'s only INSERT is entirely skipped (never converted to BSON); it still shows
        // up (from its CREATE TABLE) but with no rows, distinguishing "filtered out" from "table
        // doesn't exist" for a caller that wants to double-check its selection.
        let a = tables.iter().find(|t| t.name == "a").unwrap();
        assert_eq!(a.rows.len(), 1);
        let b = tables.iter().find(|t| t.name == "b").unwrap();
        assert_eq!(b.rows.len(), 0);
    }

    #[test]
    fn malformed_sql_is_an_error_not_a_panic() {
        assert!(parse_sql_dump("CREATE TABLE (((", None).is_err());
    }
}
