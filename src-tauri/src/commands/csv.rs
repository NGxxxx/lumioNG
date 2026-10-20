//! Import a CSV file into one collection: `csv_import_preview` reads a bounded prefix; `csv_import_commit` streams the whole file in batches.
use crate::commands::import_export::{insert_batch, summarize_import, ExportProgress, ImportResult, InsertMode};
use crate::csv_import::{convert_record, count_csv_rows, open_reader, preview_columns, CsvColumnPreview, CsvDelimiter, CsvRow};
use crate::error::AppError;
use crate::state::AppState;
use crate::value_infer::InferOptions;
use mongodb::bson::Document;
use std::io::BufReader;
use tauri::{ipc::Channel, State};
use tokio::sync::mpsc;

const CSV_PREVIEW_ROWS: usize = 30;

fn open_file(path: &str) -> Result<BufReader<std::fs::File>, AppError> {
    let file = std::fs::File::open(path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(BufReader::new(file))
}

#[tauri::command]
pub async fn csv_import_preview(
    path: String,
    delimiter: CsvDelimiter,
    infer_opts: InferOptions,
) -> Result<Vec<CsvColumnPreview>, AppError> {
    tokio::task::spawn_blocking(move || -> Result<_, AppError> {
        let reader = open_file(&path)?;
        preview_columns(reader, delimiter, CSV_PREVIEW_ROWS, &infer_opts).map_err(AppError::Parse)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

const CSV_IMPORT_BATCH: usize = 1000;

/// Reads the CSV file on a blocking thread, sending `CSV_IMPORT_BATCH`-sized chunks over a bounded (capacity 2) channel.
fn spawn_csv_producer(
    path: String,
    delimiter: CsvDelimiter,
    infer_opts: InferOptions,
) -> mpsc::Receiver<Result<Vec<CsvRow>, AppError>> {
    let (tx, rx) = mpsc::channel(2);
    tokio::task::spawn_blocking(move || {
        let (headers, mut reader) = match open_file(&path).and_then(|f| {
            open_reader(f, delimiter).map_err(AppError::Parse)
        }) {
            Ok(pair) => pair,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };
        let mut batch: Vec<CsvRow> = Vec::with_capacity(CSV_IMPORT_BATCH);
        for (i, result) in reader.records().enumerate() {
            batch.push(convert_record(i, result, &headers, &infer_opts));
            if batch.len() >= CSV_IMPORT_BATCH
                && tx.blocking_send(Ok(std::mem::take(&mut batch))).is_err() {
                    return; // consumer dropped rx (StopOnFirstError-style early exit in slice 4)
                }
        }
        if !batch.is_empty() {
            let _ = tx.blocking_send(Ok(batch));
        }
    });
    rx
}

#[tauri::command]
pub async fn csv_import_commit(
    session_id: String,
    db: String,
    coll: String,
    path: String,
    delimiter: CsvDelimiter,
    infer_opts: InferOptions,
    insert_mode: InsertMode,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    state.ensure_writable(&session_id).await?;

    state
        .audited(&session_id, crate::audit::SOURCE_IMPORT, "csv_import", &format!("{db}.{coll}"), None, |r: &ImportResult| Some(r.inserted), async {
        let count_path = path.clone();
        let total = tokio::task::spawn_blocking(move || -> Result<u64, AppError> {
            let reader = open_file(&count_path)?;
            count_csv_rows(reader, delimiter).map_err(AppError::Parse)
        })
        .await
        .map_err(|e| AppError::Io(e.to_string()))??;

        let client = state.client(&session_id).await?;
        let collection = client.database(&db).collection::<Document>(&coll);

        let mut rx = spawn_csv_producer(path, delimiter, infer_opts);
        let mut inserted: u64 = 0;
        let mut errors: Vec<String> = Vec::new();
        let mut done: u64 = 0;

        while let Some(chunk) = rx.recv().await {
            let batch_rows = chunk?;
            let batch_len = batch_rows.len();
            let mut docs = Vec::with_capacity(batch_len);
            let mut raw_idx = Vec::with_capacity(batch_len);
            for row in batch_rows {
                match row {
                    CsvRow::Doc(idx, doc) => {
                        docs.push(doc);
                        raw_idx.push(idx);
                    }
                    CsvRow::ParseError(idx, msg) => errors.push(format!("doc#{idx}: {msg}")),
                }
            }
            let mut stop = false;
            if !docs.is_empty() {
                stop = insert_batch(&collection, docs, &raw_idx, insert_mode, &mut inserted, &mut errors).await;
            }
            done += batch_len as u64;
            let _ = on_progress.send(ExportProgress { done: done.min(total), total });
            if stop {
                break; // dropping rx here signals the producer thread to stop (see spawn_csv_producer)
            }
        }

        Ok(summarize_import(inserted, errors))
        })
        .await
}
