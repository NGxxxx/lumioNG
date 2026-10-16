//! Import a generic SQL dump into one MongoDB collection per table: `sql_import_preview` lists tables; `sql_import_commit` streams and inserts.
use crate::commands::import_export::{insert_batch, InsertMode};
use crate::error::AppError;
use crate::sql_import::{
    insert_table_ident, insert_values_rows, parse_one_statement, resolve_insert_columns,
    resolve_target_collection, row_to_document, SqlSchemaAccumulator,
};
use crate::sql_stream::SqlStatementReader;
use crate::state::{AppState, CancelScope};
use crate::value_infer::InferOptions;
use mongodb::bson::Document;
use sqlparser::ast::Statement;
use std::collections::HashMap;
use std::io::BufReader;
use std::sync::atomic::Ordering;
use tauri::{ipc::Channel, State};
use tokio::sync::mpsc;

fn open_file(path: &str) -> Result<BufReader<std::fs::File>, AppError> {
    let file = std::fs::File::open(path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(BufReader::new(file))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlColumnPreview {
    pub name: String,
    pub inferred_type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlTablePreview {
    pub table: String,
    pub columns: Vec<SqlColumnPreview>,
    pub row_count: u64,
}

#[tauri::command]
pub async fn sql_import_preview(path: String) -> Result<Vec<SqlTablePreview>, AppError> {
    tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        let reader = open_file(&path)?;
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let mut acc = SqlSchemaAccumulator::new(true, opts);
        let mut scanner = SqlStatementReader::new(reader);
        while let Some(text) = scanner.next_statement().map_err(AppError::Parse)? {
            // A statement that fails to parse is skipped, not fatal; a scanner-level structural failure still propagates via `next_statement()`'s `?`.
            if let Ok(stmt) = parse_one_statement(&text) {
                acc.add_statement(&stmt);
            }
        }
        let (schemas, _) = acc.finish();
        let previews = schemas
            .into_iter()
            .map(|t| {
                let columns = t
                    .columns
                    .into_iter()
                    .zip(t.column_types)
                    .map(|(name, inferred_type)| SqlColumnPreview { name, inferred_type })
                    .collect();
                SqlTablePreview { table: t.name, columns, row_count: t.row_count }
            })
            .collect();
        Ok(previews)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[derive(serde::Serialize, Clone)]
pub struct SqlImportProgress {
    pub table: String,
    pub done: u64,
    pub total: u64,
}

#[derive(serde::Serialize)]
pub struct SqlImportTableResult {
    pub table: String,
    pub inserted: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// `cancelled` marks a partial result from a user-requested stop, not a full completion.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlImportCommitResult {
    pub tables: Vec<SqlImportTableResult>,
    pub cancelled: bool,
}

const SQL_IMPORT_BATCH: usize = 1000;

/// Rows buffered across *all* tables before every non-empty buffer is flushed. A dump with hundreds
/// of small tables never reaches `SQL_IMPORT_BATCH` on any single table, so without this cap the
/// whole dump would sit in memory until EOF.
const SQL_IMPORT_MAX_BUFFERED_ROWS: usize = 5000;

/// Streams the SQL file, buffering each table's rows across statements and flushing at `SQL_IMPORT_BATCH`
/// per table or `SQL_IMPORT_MAX_BUFFERED_ROWS` in total.
fn spawn_sql_producer(
    path: String,
    tables: Vec<String>,
    columns_by_table: HashMap<String, Vec<String>>,
    infer_opts: InferOptions,
) -> mpsc::Receiver<Result<(String, Vec<Document>), AppError>> {
    let (tx, rx) = mpsc::channel(2);
    tokio::task::spawn_blocking(move || {
        let reader = match open_file(&path) {
            Ok(r) => r,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };
        let mut scanner = SqlStatementReader::new(reader);
        let mut buffers: HashMap<String, Vec<Document>> = HashMap::new();
        let mut buffered_total: usize = 0;
        loop {
            let text = match scanner.next_statement() {
                Ok(Some(t)) => t,
                Ok(None) => break,
                Err(e) => {
                    let _ = tx.blocking_send(Err(AppError::Parse(e)));
                    return;
                }
            };
            let Ok(Statement::Insert(insert)) = parse_one_statement(&text) else { continue };
            let table = insert_table_ident(&insert);
            if !tables.contains(&table) {
                continue;
            }
            let cols = resolve_insert_columns(&insert, &columns_by_table);
            if cols.is_empty() {
                continue;
            }
            let Some(rows) = insert_values_rows(&insert) else { continue };
            let buffer = buffers.entry(table.clone()).or_default();
            for row in rows {
                buffer.push(row_to_document(&cols, row, &infer_opts));
                buffered_total += 1;
                if buffer.len() >= SQL_IMPORT_BATCH {
                    let batch = std::mem::take(buffer);
                    buffered_total -= batch.len();
                    if tx.blocking_send(Ok((table.clone(), batch))).is_err() {
                        return; // consumer dropped rx (StopOnFirstError-style early exit)
                    }
                }
            }
            // Bound total memory: flush the largest buffers first, down to a low-water mark (not
            // every table) so a many-small-tables dump doesn't turn into tiny per-table inserts.
            if buffered_total >= SQL_IMPORT_MAX_BUFFERED_ROWS {
                let mut by_size: Vec<String> = buffers
                    .iter()
                    .filter(|(_, b)| !b.is_empty())
                    .map(|(t, _)| t.clone())
                    .collect();
                by_size.sort_by_key(|t| std::cmp::Reverse(buffers[t].len()));
                for buffered_table in by_size {
                    if buffered_total < SQL_IMPORT_MAX_BUFFERED_ROWS / 2 {
                        break;
                    }
                    let Some(buf) = buffers.get_mut(&buffered_table) else { continue };
                    let batch = std::mem::take(buf);
                    buffered_total -= batch.len();
                    if tx.blocking_send(Ok((buffered_table, batch))).is_err() {
                        return;
                    }
                }
            }
        }
        for (table, batch) in buffers {
            if !batch.is_empty() {
                let _ = tx.blocking_send(Ok((table, batch)));
            }
        }
    });
    rx
}

/// Requests cancellation of an in-flight `sql_import_commit` on this session.
#[tauri::command]
pub async fn cancel_import(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.request_cancel(&session_id, CancelScope::Job).await;
    Ok(())
}

#[tauri::command]
pub async fn sql_import_commit(
    session_id: String,
    db: String,
    path: String,
    tables: Vec<String>,
    target_coll: Option<String>,
    insert_mode: InsertMode,
    on_progress: Channel<SqlImportProgress>,
    state: State<'_, AppState>,
) -> Result<SqlImportCommitResult, AppError> {
    state.ensure_writable(&session_id).await?;
    let cancel = state.begin_cancel(&session_id, CancelScope::Job).await;

    let schema_path = path.clone();
    let (schemas, columns_by_table) = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        let reader = open_file(&schema_path)?;
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let mut acc = SqlSchemaAccumulator::new(false, opts);
        let mut scanner = SqlStatementReader::new(reader);
        while let Some(text) = scanner.next_statement().map_err(AppError::Parse)? {
            if let Ok(stmt) = parse_one_statement(&text) {
                acc.add_statement(&stmt);
            }
        }
        Ok(acc.finish())
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;

    let totals: HashMap<String, u64> = schemas.iter().map(|s| (s.name.clone(), s.row_count)).collect();
    // Preserve the dump's first-seen table order, restricted to the selected tables — matches the
    // pre-rewrite output order and keeps a selected-but-empty table in the results (inserted: 0).
    let order: Vec<String> = schemas.into_iter().map(|s| s.name).filter(|n| tables.contains(n)).collect();
    let infer_opts = InferOptions { parse_json_like: true, infer_scalars: true };

    let mut rx = spawn_sql_producer(path, tables, columns_by_table, infer_opts);
    let mut inserted_by_table: HashMap<String, u64> = HashMap::new();
    let mut errors_by_table: HashMap<String, Vec<String>> = HashMap::new();
    let mut cancelled = false;

    while let Some(msg) = rx.recv().await {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break; // dropping rx here signals spawn_sql_producer's blocking_send to stop, same as `stop` below
        }
        let (table, batch) = msg?;
        let coll_name = resolve_target_collection(&table, target_coll.as_deref());
        let collection = client.database(&db).collection::<Document>(&coll_name);
        let total = *totals.get(&table).unwrap_or(&0);

        let inserted_entry = inserted_by_table.entry(table.clone()).or_insert(0);
        let errors_entry = errors_by_table.entry(table.clone()).or_default();
        let start = (*inserted_entry + errors_entry.len() as u64) as usize;
        let raw_idx: Vec<usize> = (start..start + batch.len()).collect();
        let stop = insert_batch(&collection, batch, &raw_idx, insert_mode, inserted_entry, errors_entry).await;
        let done = (*inserted_entry + errors_entry.len() as u64).min(total);
        let _ = on_progress.send(SqlImportProgress { table: table.clone(), done, total });
        if stop {
            break; // dropping rx here signals spawn_sql_producer's blocking_send to stop
        }
    }

    let tables = order
        .into_iter()
        .map(|table| {
            let inserted = inserted_by_table.remove(&table).unwrap_or(0);
            let mut errors = errors_by_table.remove(&table).unwrap_or_default();
            let failed = errors.len() as u64;
            errors.truncate(5);
            SqlImportTableResult { table, inserted, failed, errors }
        })
        .collect();
    Ok(SqlImportCommitResult { tables, cancelled })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each message received is one DB round trip, so same-table rows must coalesce, not stream 1:1.
    #[tokio::test]
    async fn many_single_row_inserts_for_the_same_table_are_coalesced_into_one_batch() {
        let dir = std::env::temp_dir().join("monglumio_test_sql_producer_coalesce");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("dump.sql");
        let mut sql = String::from("CREATE TABLE t (a INT);\n");
        for i in 0..5 {
            sql.push_str(&format!("INSERT INTO t (a) VALUES ({i});\n"));
        }
        std::fs::write(&path, &sql).unwrap();

        let mut columns_by_table = HashMap::new();
        columns_by_table.insert("t".to_string(), vec!["a".to_string()]);
        let infer_opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let mut rx = spawn_sql_producer(
            path.to_string_lossy().to_string(),
            vec!["t".to_string()],
            columns_by_table,
            infer_opts,
        );

        let mut messages = 0;
        let mut total_docs = 0;
        while let Some(msg) = rx.recv().await {
            let (table, batch) = msg.unwrap();
            assert_eq!(table, "t");
            messages += 1;
            total_docs += batch.len();
        }
        assert_eq!(total_docs, 5);
        assert_eq!(messages, 1, "5 single-row INSERT statements should coalesce into 1 batch, not 5 round trips");

        let _ = std::fs::remove_file(&path);
    }

    /// Many tables each below `SQL_IMPORT_BATCH` must still flush mid-scan, otherwise the whole
    /// dump is resident before the first row reaches the consumer.
    #[tokio::test]
    async fn many_small_tables_flush_before_eof_instead_of_buffering_the_whole_dump() {
        const TABLES: usize = 10;
        const ROUNDS: usize = 6;
        const ROWS_PER_STATEMENT: usize = 100;

        let dir = std::env::temp_dir().join("monglumio_test_sql_producer_total_cap");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("dump.sql");

        let mut sql = String::new();
        for t in 0..TABLES {
            sql.push_str(&format!("CREATE TABLE t{t} (a INT);\n"));
        }
        // Round-robin over the tables so no single table ever reaches SQL_IMPORT_BATCH (600 rows each).
        for round in 0..ROUNDS {
            for t in 0..TABLES {
                let values: Vec<String> = (0..ROWS_PER_STATEMENT)
                    .map(|i| format!("({})", round * ROWS_PER_STATEMENT + i))
                    .collect();
                sql.push_str(&format!("INSERT INTO t{t} (a) VALUES {};\n", values.join(", ")));
            }
        }
        std::fs::write(&path, &sql).unwrap();

        let mut columns_by_table = HashMap::new();
        let tables: Vec<String> = (0..TABLES).map(|t| format!("t{t}")).collect();
        for table in &tables {
            columns_by_table.insert(table.clone(), vec!["a".to_string()]);
        }
        let infer_opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let mut rx = spawn_sql_producer(
            path.to_string_lossy().to_string(),
            tables.clone(),
            columns_by_table,
            infer_opts,
        );

        let mut messages = 0;
        let mut total_docs = 0;
        let mut t0_values: Vec<i64> = Vec::new();
        while let Some(msg) = rx.recv().await {
            let (table, batch) = msg.unwrap();
            messages += 1;
            total_docs += batch.len();
            if table == "t0" {
                t0_values.extend(batch.iter().map(|d| d.get_i64("a").unwrap()));
            }
        }

        assert_eq!(total_docs, TABLES * ROUNDS * ROWS_PER_STATEMENT);
        assert!(
            messages > TABLES,
            "expected at least one mid-scan flush per table beyond the final drain, got {messages} messages"
        );
        // A table split across flushes must still arrive in insert order.
        assert_eq!(t0_values, (0..(ROUNDS * ROWS_PER_STATEMENT) as i64).collect::<Vec<_>>());

        let _ = std::fs::remove_file(&path);
    }
}
