//! Import a generic SQL dump (`CREATE TABLE` + `INSERT INTO` only) into one MongoDB collection
//! per table. Two-step: `sql_import_preview` lists tables to pick from; `sql_import_commit`
//! re-parses (simpler than caching across IPC calls) and inserts the selected ones.
use crate::commands::import_export::insert_batch;
use crate::error::AppError;
use crate::sql_import::parse_sql_dump;
use crate::state::AppState;
use mongodb::bson::Document;
use std::collections::HashSet;
use tauri::{ipc::Channel, State};

fn read_sql_file(path: &str) -> Result<String, AppError> {
    std::fs::read_to_string(path).map_err(|e| AppError::Io(e.to_string()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlTablePreview {
    pub table: String,
    pub columns: Vec<String>,
    pub row_count: u64,
}

#[tauri::command]
pub async fn sql_import_preview(path: String) -> Result<Vec<SqlTablePreview>, AppError> {
    let tables = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        let content = read_sql_file(&path)?;
        parse_sql_dump(&content, None).map_err(AppError::Parse)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    Ok(tables
        .into_iter()
        .map(|t| SqlTablePreview {
            table: t.name,
            columns: t.columns,
            row_count: t.rows.len() as u64,
        })
        .collect())
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
pub async fn sql_import_commit(
    session_id: String,
    db: String,
    path: String,
    tables: Vec<String>,
    on_progress: Channel<SqlImportProgress>,
    state: State<'_, AppState>,
) -> Result<Vec<SqlImportTableResult>, AppError> {
    let only_tables: HashSet<String> = tables.iter().cloned().collect();
    let parsed = tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        let content = read_sql_file(&path)?;
        parse_sql_dump(&content, Some(&only_tables)).map_err(AppError::Parse)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;

    let mut results = Vec::new();
    for t in parsed {
        if !tables.contains(&t.name) {
            continue;
        }
        let collection = client.database(&db).collection::<Document>(&t.name);
        let total = t.rows.len() as u64;
        let mut inserted: u64 = 0;
        let mut errors: Vec<String> = Vec::new();

        for (chunk_idx, chunk) in t.rows.chunks(SQL_IMPORT_BATCH).enumerate() {
            let batch: Vec<Document> = chunk.to_vec();
            let start = chunk_idx * SQL_IMPORT_BATCH;
            let raw_idx: Vec<usize> = (start..start + batch.len()).collect();
            insert_batch(&collection, batch, &raw_idx, &mut inserted, &mut errors).await;
            let done = (inserted + errors.len() as u64).min(total);
            let _ = on_progress.send(SqlImportProgress { table: t.name.clone(), done, total });
        }

        let failed = errors.len() as u64;
        errors.truncate(5);
        results.push(SqlImportTableResult { table: t.name, inserted, failed, errors });
    }
    Ok(results)
}
