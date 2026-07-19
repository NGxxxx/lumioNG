//! Import a generic SQL dump (`CREATE TABLE` + `INSERT INTO` only) into one MongoDB collection
//! per table. Two-step: `sql_import_preview` lists tables to pick from; `sql_import_commit`
//! re-parses (simpler than caching across IPC calls) and inserts the selected ones.
use crate::commands::import_export::{insert_batch, InsertMode};
use crate::error::AppError;
use crate::sql_import::{
    insert_values_rows, parse_statements, resolve_insert_columns, resolve_target_collection,
    row_to_document, table_column_types, table_columns, table_ident, table_schemas,
};
use crate::state::AppState;
use crate::value_infer::InferOptions;
use mongodb::bson::Document;
use sqlparser::ast::Statement;
use std::collections::HashMap;
use tauri::{ipc::Channel, State};

fn read_sql_file(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))
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
        let content = read_sql_file(&path)?;
        let statements = parse_statements(&content).map_err(AppError::Parse)?;
        let opts = InferOptions { parse_json_like: true, infer_scalars: true };
        let previews = table_schemas(&statements)
            .into_iter()
            .map(|t| {
                let types = table_column_types(&statements, &t.name, &t.columns, &opts);
                let columns = t
                    .columns
                    .into_iter()
                    .zip(types)
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

const SQL_IMPORT_BATCH: usize = 1000;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sql_import_commit(
    session_id: String,
    db: String,
    path: String,
    tables: Vec<String>,
    target_coll: Option<String>,
    insert_mode: InsertMode,
    on_progress: Channel<SqlImportProgress>,
    state: State<'_, AppState>,
) -> Result<Vec<SqlImportTableResult>, AppError> {
    state.ensure_writable(&session_id).await?;

    let statements = tokio::task::spawn_blocking(move || -> Result<Vec<Statement>, AppError> {
        let content = read_sql_file(&path)?;
        parse_statements(&content).map_err(AppError::Parse)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;

    let schemas = table_schemas(&statements);
    let is_single_table_dump = schemas.len() == 1;
    let totals: HashMap<String, u64> = schemas.iter().map(|s| (s.name.clone(), s.row_count)).collect();
    // Preserve the dump's first-seen table order, restricted to the selected tables — matches the
    // pre-rewrite output order and keeps a selected-but-empty table in the results (inserted: 0).
    let order: Vec<String> = schemas.into_iter().map(|s| s.name).filter(|n| tables.contains(n)).collect();
    let columns_by_table = table_columns(&statements);
    let infer_opts = InferOptions { parse_json_like: true, infer_scalars: true };

    let mut inserted_by_table: HashMap<String, u64> = HashMap::new();
    let mut errors_by_table: HashMap<String, Vec<String>> = HashMap::new();

    'tables: for stmt in &statements {
        let Statement::Insert(insert) = stmt else { continue };
        let table = table_ident(&insert.table_name);
        if !tables.contains(&table) {
            continue;
        }
        let cols = resolve_insert_columns(insert, &columns_by_table);
        if cols.is_empty() {
            continue;
        }
        let Some(rows) = insert_values_rows(insert) else { continue };

        let coll_name = resolve_target_collection(&table, is_single_table_dump, target_coll.as_deref());
        let collection = client.database(&db).collection::<Document>(&coll_name);
        let total = *totals.get(&table).unwrap_or(&0);

        for chunk in rows.chunks(SQL_IMPORT_BATCH) {
            // Converted only for this one chunk, inserted, then dropped — never holds every row of
            // every table as `Bson` simultaneously, unlike the old parse-everything-then-insert path.
            let batch: Vec<Document> =
                chunk.iter().map(|row| row_to_document(&cols, row, &infer_opts)).collect();
            let inserted_entry = inserted_by_table.entry(table.clone()).or_insert(0);
            let errors_entry = errors_by_table.entry(table.clone()).or_insert_with(Vec::new);
            let start = (*inserted_entry + errors_entry.len() as u64) as usize;
            let raw_idx: Vec<usize> = (start..start + batch.len()).collect();
            let stop = insert_batch(&collection, batch, &raw_idx, insert_mode, inserted_entry, errors_entry).await;
            let done = (*inserted_entry + errors_entry.len() as u64).min(total);
            let _ = on_progress.send(SqlImportProgress { table: table.clone(), done, total });
            if stop {
                break 'tables;
            }
        }
    }

    Ok(order
        .into_iter()
        .map(|table| {
            let inserted = inserted_by_table.remove(&table).unwrap_or(0);
            let mut errors = errors_by_table.remove(&table).unwrap_or_default();
            let failed = errors.len() as u64;
            errors.truncate(5);
            SqlImportTableResult { table, inserted, failed, errors }
        })
        .collect())
}
