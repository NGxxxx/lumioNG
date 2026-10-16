use crate::bson_import::count_bson_docs_streaming;
use crate::bson_json::{doc_to_canonical_string, doc_to_raw, RawDoc};
use crate::error::AppError;
use crate::json_import::{count_jsonl_lines, detect_json_array, parse_array_element, parse_jsonl_line};
use crate::state::AppState;
use futures::stream::{self, StreamExt, TryStreamExt};
use mongodb::bson::Document;
use mongodb::error::ErrorKind;
use mongodb::Cursor;
use std::io::Write;
use std::sync::atomic::Ordering;
use tauri::{ipc::Channel, State};
use tokio::sync::mpsc;

use super::query::build_find_options;

const MAX_IMPORT_ERRORS: usize = 5;
const PROGRESS_BATCH: u64 = 1000;

/// Hard ceilings on `export_query_progress` ("Show all") -- the frontend's confirm dialog is only
/// advisory. Doesn't cover the Query tab's script-driven show-all (`query_page`/`aggregate`).
const MAX_SHOW_ALL_DOCS: u64 = 200_000;
const MAX_SHOW_ALL_BYTES: usize = 256 * 1024 * 1024;

/// Friendly, actionable message for the "Show all" cap -- same tone as the Mongo error mapping in `error.rs`.
fn show_all_cap_error(matched: Option<u64>) -> AppError {
    let scope = match matched {
        Some(n) => format!("matches {n} documents"),
        None => format!("matches more than {MAX_SHOW_ALL_DOCS} documents"),
    };
    AppError::Query(format!(
        "This query {scope}, over the {MAX_SHOW_ALL_DOCS} document limit for \"Show all\". \
         Narrow the filter, or export the result to a file instead."
    ))
}

fn show_all_byte_cap_error() -> AppError {
    AppError::Query(format!(
        "This query's results exceed the {}MB size limit for \"Show all\". \
         Narrow the filter, or export the result to a file instead.",
        MAX_SHOW_ALL_BYTES / (1024 * 1024)
    ))
}

#[derive(serde::Serialize, Clone)]
pub struct ExportProgress {
    pub done: u64,
    pub total: u64,
}

/// Shared setup for the `export_*` commands: create the parent directory if needed and open a buffered writer at `path`, truncating any existing file.
pub(crate) fn create_output_writer(path: &std::path::Path) -> Result<std::io::BufWriter<std::fs::File>, AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let file = std::fs::File::create(path).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(std::io::BufWriter::new(file))
}

/// Shared setup for the `export_*` commands: open the sorted (optionally projected) cursor over
/// matching documents and return it with the total match count. The count and the cursor open are
/// independent reads against the same filter, so they run concurrently.
async fn open_export_cursor(
    state: State<'_, AppState>,
    session_id: &str,
    db: &str,
    coll: &str,
    filter: Option<&str>,
    sort: Option<&str>,
    projection: Option<&str>,
) -> Result<(Cursor<Document>, u64), AppError> {
    let client = state.client(session_id).await?;
    let collection = client.database(db).collection::<Document>(coll);
    let (filter_doc, sort_doc, proj_doc) = build_find_options(filter, sort, projection)?;
    let mut q = collection.find(filter_doc.clone()).sort(sort_doc);
    if let Some(p) = proj_doc {
        q = q.projection(p);
    }
    let (cursor, total) = tokio::try_join!(q, collection.count_documents(filter_doc))?;
    Ok((cursor, total))
}

/// Checks the per-session cancel flag; returns an error to unwind the export/import loop once the user requests cancellation.
pub(crate) fn check_cancelled(cancel: &std::sync::atomic::AtomicBool) -> Result<(), AppError> {
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::Query("Export cancelled".into()));
    }
    Ok(())
}

/// Same as `open_export_cursor` but skips `count_documents`, for a second pass where the caller already has `total`.
async fn open_write_cursor(
    state: State<'_, AppState>,
    session_id: &str,
    db: &str,
    coll: &str,
    filter: Option<&str>,
    sort: Option<&str>,
    projection: Option<&str>,
) -> Result<Cursor<Document>, AppError> {
    let client = state.client(session_id).await?;
    let collection = client.database(db).collection::<Document>(coll);
    let (filter_doc, sort_doc, proj_doc) = build_find_options(filter, sort, projection)?;
    let mut q = collection.find(filter_doc).sort(sort_doc);
    if let Some(p) = proj_doc {
        q = q.projection(p);
    }
    Ok(q.await?)
}

/// Runs `fut`; on error, best-effort deletes the (already-created) partial output file at `path`
/// before propagating, so a mid-export I/O failure or cancellation doesn't leave a truncated file.
pub(crate) async fn cleanup_on_err<T>(
    path: &std::path::Path,
    fut: impl std::future::Future<Output = Result<T, AppError>>,
) -> Result<T, AppError> {
    match fut.await {
        Ok(v) => Ok(v),
        Err(e) => {
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
}

/// Write one element into a streaming JSON-array body: opening `[` for the first element, `,` before each subsequent one, then the document JSON.
fn write_json_array_element<W: Write>(w: &mut W, doc_json: &str, first: bool) -> std::io::Result<()> {
    w.write_all(if first { b"[\n" } else { b",\n" })?;
    w.write_all(doc_json.as_bytes())
}
/// Close a streaming JSON-array body; `any` = at least one element was written (empty array is written as `[]`).
fn finish_json_array<W: Write>(w: &mut W, any: bool) -> std::io::Result<()> {
    w.write_all(if any { b"\n]" } else { b"[]" })
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub inserted: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// Build an ImportResult from an inserted count and error messages, capping errors at MAX_IMPORT_ERRORS.
pub(crate) fn summarize_import(inserted: u64, mut errors: Vec<String>) -> ImportResult {
    let failed = errors.len() as u64;
    errors.truncate(MAX_IMPORT_ERRORS);
    ImportResult { inserted, failed, errors }
}

/// Shared insert behavior across every import path; default is `SkipDuplicates`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InsertMode {
    /// Today's only behavior: `insert_many(..).ordered(false)` — every document in the batch is
    /// attempted regardless of an earlier one failing (e.g. a duplicate `_id`).
    SkipDuplicates,
    /// `replace_one` with `upsert: true`, keyed on `_id`, looped one document at a time within the
    /// batch (still bounded to one batch's documents in flight).
    UpsertById,
    /// `insert_many(..).ordered(true)` — stops at the first write error; documents after the
    /// failing one (in this batch and in any later batch) are never attempted.
    StopOnFirstError,
}

/// Folds an unordered `insert_many`'s write errors into `inserted`/`errors`, remapping each batch-local index to `raw_idx[index]`.
pub(crate) fn apply_unordered_write_errors(
    write_errors: &[mongodb::error::IndexedWriteError],
    raw_idx: &[usize],
    batch_len: u64,
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    for w in write_errors {
        let raw = raw_idx.get(w.index).copied().unwrap_or(w.index);
        errors.push(format!("doc#{raw}: {}", w.message));
    }
    *inserted += batch_len.saturating_sub(write_errors.len() as u64);
}

/// Folds an ordered `insert_many`'s single write error: only documents strictly before `write_error.index` actually landed.
pub(crate) fn apply_ordered_write_error(
    write_error: &mongodb::error::IndexedWriteError,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    *inserted += write_error.index as u64;
    let raw = raw_idx.get(write_error.index).copied().unwrap_or(write_error.index);
    errors.push(format!("doc#{raw}: {}", write_error.message));
}

/// Inserts one already-parsed batch under `mode`; returns `true` if the caller should stop pulling further batches (`StopOnFirstError` only).
pub(crate) async fn insert_batch(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    mode: InsertMode,
    inserted: &mut u64,
    errors: &mut Vec<String>,
) -> bool {
    match mode {
        InsertMode::SkipDuplicates => {
            insert_many_unordered(collection, batch, raw_idx, inserted, errors).await;
            false
        }
        InsertMode::StopOnFirstError => {
            insert_many_ordered(collection, batch, raw_idx, inserted, errors).await
        }
        InsertMode::UpsertById => {
            upsert_by_id(collection, batch, raw_idx, inserted, errors).await;
            false
        }
    }
}

async fn insert_many_unordered(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    let batch_len = batch.len() as u64;
    match collection.insert_many(batch).ordered(false).await {
        Ok(res) => *inserted += res.inserted_ids.len() as u64,
        Err(e) => match &*e.kind {
            ErrorKind::InsertMany(ime) => match &ime.write_errors {
                Some(we) => apply_unordered_write_errors(we, raw_idx, batch_len, inserted, errors),
                None => errors.push(e.to_string()),
            },
            // Plan-mandated: non-write errors are recorded into `errors`, not propagated (keeps the helper infallible and consistent with BSON import).
            _ => errors.push(e.to_string()),
        },
    }
}

/// Returns `true` if a write error occurred (the caller should stop pulling further batches).
async fn insert_many_ordered(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) -> bool {
    match collection.insert_many(batch).ordered(true).await {
        Ok(res) => {
            *inserted += res.inserted_ids.len() as u64;
            false
        }
        Err(e) => match &*e.kind {
            ErrorKind::InsertMany(ime) => match ime.write_errors.as_deref() {
                Some([first, ..]) => {
                    apply_ordered_write_error(first, raw_idx, inserted, errors);
                    true
                }
                _ => {
                    errors.push(e.to_string());
                    true
                }
            },
            _ => {
                errors.push(e.to_string());
                true
            }
        },
    }
}

/// Bounded fan-out for per-document `replace_one` — avoids `Client::bulk_write` (server 8.0+ only) so upsert-by-id stays compatible with older servers.
const UPSERT_CONCURRENCY: usize = 16;

async fn upsert_by_id(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    let mut results: Vec<(usize, Result<(), String>)> = stream::iter(batch.into_iter().zip(raw_idx.iter().copied()))
        .map(|(doc, raw)| {
            let collection = collection.clone();
            async move {
                let Some(id) = doc.get("_id").cloned() else {
                    return (raw, Err("upsert requires an _id field".to_string()));
                };
                let filter = mongodb::bson::doc! { "_id": id };
                match collection.replace_one(filter, doc).upsert(true).await {
                    Ok(_) => (raw, Ok(())),
                    Err(e) => (raw, Err(e.to_string())),
                }
            }
        })
        .buffer_unordered(UPSERT_CONCURRENCY)
        .collect()
        .await;
    results.sort_by_key(|(raw, _)| *raw);
    for (raw, r) in results {
        match r {
            Ok(()) => *inserted += 1,
            Err(e) => errors.push(format!("doc#{raw}: {e}")),
        }
    }
}

/// One item from any JSON/JSONL/BSON import producer: parsed, or an unprefixed parse-error message.
type ImportItem = Result<Document, String>;

/// Drains `rx`, inserting each batch and reporting progress, until the channel closes or `insert_batch` signals stop.
async fn consume_import_batches(
    mut rx: mpsc::Receiver<Result<Vec<ImportItem>, AppError>>,
    collection: &mongodb::Collection<Document>,
    insert_mode: InsertMode,
    total: u64,
    on_progress: &Channel<ExportProgress>,
) -> Result<ImportResult, AppError> {
    let mut inserted: u64 = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut done: u64 = 0;

    while let Some(chunk) = rx.recv().await {
        let items = chunk?;
        let batch_len = items.len();
        let raw_start = done as usize;
        let mut docs = Vec::with_capacity(batch_len);
        let mut raw_idx = Vec::with_capacity(batch_len);
        for (i, item) in items.into_iter().enumerate() {
            match item {
                Ok(d) => {
                    docs.push(d);
                    raw_idx.push(raw_start + i);
                }
                Err(e) => errors.push(format!("doc#{}: {e}", raw_start + i)),
            }
        }
        let mut stop = false;
        if !docs.is_empty() {
            stop = insert_batch(collection, docs, &raw_idx, insert_mode, &mut inserted, &mut errors).await;
        }
        done += batch_len as u64;
        let _ = on_progress.send(ExportProgress { done, total });
        if stop {
            break;
        }
    }
    Ok(summarize_import(inserted, errors))
}

/// Drives a per-document producer on a blocking thread, batching `PROGRESS_BATCH` items at a time
/// over a bounded channel -- shared scaffolding for the JSONL/JSON-array/BSON import producers.
/// `next` is called repeatedly and should return `Ok(Some(item))` per parsed item, `Ok(None)` at
/// end of input, or `Err` for a fatal read/parse error that aborts the whole import.
fn spawn_batched_producer(
    mut next: impl FnMut() -> Result<Option<ImportItem>, AppError> + Send + 'static,
) -> mpsc::Receiver<Result<Vec<ImportItem>, AppError>> {
    let (tx, rx) = mpsc::channel(2);
    tokio::task::spawn_blocking(move || {
        let mut batch: Vec<ImportItem> = Vec::with_capacity(PROGRESS_BATCH as usize);
        loop {
            match next() {
                Ok(Some(item)) => {
                    batch.push(item);
                    if batch.len() >= PROGRESS_BATCH as usize
                        && tx.blocking_send(Ok(std::mem::take(&mut batch))).is_err()
                    {
                        return; // consumer dropped rx (StopOnFirstError early exit)
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    return;
                }
            }
        }
        if !batch.is_empty() {
            let _ = tx.blocking_send(Ok(batch));
        }
    });
    rx
}

/// Streams a JSONL file, sending `PROGRESS_BATCH`-sized batches over a bounded channel.
fn spawn_jsonl_producer(path: String) -> mpsc::Receiver<Result<Vec<ImportItem>, AppError>> {
    use std::io::BufRead as _;
    let mut lines: Option<std::io::Lines<std::io::BufReader<std::fs::File>>> = None;
    spawn_batched_producer(move || {
        let it = match &mut lines {
            Some(it) => it,
            None => {
                let file = std::fs::File::open(&path).map_err(|e| AppError::Io(e.to_string()))?;
                lines.insert(std::io::BufReader::new(file).lines())
            }
        };
        loop {
            match it.next() {
                Some(Ok(line)) => {
                    if let Some(item) = parse_jsonl_line(&line) {
                        return Ok(Some(item));
                    } // else: blank line, pull the next one
                }
                Some(Err(e)) => return Err(AppError::Io(e.to_string())),
                None => return Ok(None),
            }
        }
    })
}

/// Streams a JSON-array file via `json_stream::ArrayElementReader`, sending `PROGRESS_BATCH`-sized
/// batches over a bounded channel.
fn spawn_json_array_producer(path: String) -> mpsc::Receiver<Result<Vec<ImportItem>, AppError>> {
    let mut elements: Option<crate::json_stream::ArrayElementReader<std::io::BufReader<std::fs::File>>> = None;
    spawn_batched_producer(move || {
        let it = match &mut elements {
            Some(it) => it,
            None => {
                let file = std::fs::File::open(&path).map_err(|e| AppError::Io(e.to_string()))?;
                let reader = std::io::BufReader::new(file);
                let reader = crate::json_stream::ArrayElementReader::new(reader).map_err(AppError::Parse)?;
                elements.insert(reader)
            }
        };
        match it.next_element() {
            Ok(Some(text)) => Ok(Some(parse_array_element(&text))),
            Ok(None) => Ok(None),
            Err(e) => Err(AppError::Parse(e)),
        }
    })
}

/// Streams concatenated BSON documents, reading exactly `total` documents (already validated by
/// the count pass), sending `PROGRESS_BATCH`-sized batches over a bounded channel.
fn spawn_bson_producer(path: String, total: u64) -> mpsc::Receiver<Result<Vec<ImportItem>, AppError>> {
    let mut reader: Option<std::io::BufReader<std::fs::File>> = None;
    let mut remaining = total;
    spawn_batched_producer(move || {
        let r = match &mut reader {
            Some(r) => r,
            None => {
                let file = std::fs::File::open(&path).map_err(|e| AppError::Io(e.to_string()))?;
                reader.insert(std::io::BufReader::new(file))
            }
        };
        if remaining == 0 {
            return Ok(None);
        }
        remaining -= 1;
        match Document::from_reader(r) {
            Ok(d) => Ok(Some(Ok(d))),
            Err(e) => Err(AppError::Parse(e.to_string())),
        }
    })
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    std::fs::write(p, contents).map_err(|e| AppError::Io(e.to_string()))
}

/// Reads a file's byte length without loading its content — backs the frontend's large-file
/// confirm gate, checked before any import path starts parsing.
#[tauri::command]
pub fn import_file_size(path: String) -> Result<u64, AppError> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Reads a text file if it exists, `None` if it doesn't — used to detect a companion
/// `.metadata.json` sidecar next to a chosen import file without treating "missing" as an error.
#[tauri::command]
pub fn read_text_file_if_exists(path: String) -> Result<Option<String>, AppError> {
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

#[tauri::command]
pub async fn import_documents(
    session_id: String,
    db: String,
    coll: String,
    path: String,
    insert_mode: InsertMode,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    state.ensure_writable(&session_id).await?;

    let count_path = path.clone();
    let (is_array, total) = tokio::task::spawn_blocking(move || -> Result<(bool, u64), AppError> {
        let is_array = detect_json_array(&count_path)?;
        let file = std::fs::File::open(&count_path).map_err(|e| AppError::Io(e.to_string()))?;
        let reader = std::io::BufReader::new(file);
        let total = if is_array {
            crate::json_stream::count_array_elements(reader).map_err(AppError::Parse)?
        } else {
            count_jsonl_lines(reader)?
        };
        Ok((is_array, total))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let rx = if is_array {
        spawn_json_array_producer(path)
    } else {
        spawn_jsonl_producer(path)
    };
    consume_import_batches(rx, &collection, insert_mode, total, &on_progress).await
}

#[tauri::command]
pub async fn export_json_progress(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    path: String,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    let mut w = create_output_writer(p)?;

    let count = cleanup_on_err(p, async {
        let mut count: u64 = 0;
        while let Some(d) = cursor.try_next().await? {
            check_cancelled(&cancel)?;
            let s = doc_to_canonical_string(d)?;
            write_json_array_element(&mut w, &s, count == 0).map_err(|e| AppError::Io(e.to_string()))?;
            count += 1;
            if count.is_multiple_of(PROGRESS_BATCH) {
                let _ = on_progress.send(ExportProgress { done: count, total });
            }
        }
        finish_json_array(&mut w, count > 0).map_err(|e| AppError::Io(e.to_string()))?;
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(count)
    })
    .await?;

    let _ = on_progress.send(ExportProgress { done: count, total });
    Ok(count)
}

#[tauri::command]
pub async fn export_bson_progress(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    path: String,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    let mut w = create_output_writer(p)?;

    let count = cleanup_on_err(p, async {
        let mut count: u64 = 0;
        while let Some(d) = cursor.try_next().await? {
            check_cancelled(&cancel)?;
            let bytes = mongodb::bson::to_vec(&d).map_err(|e| AppError::Parse(e.to_string()))?;
            w.write_all(&bytes).map_err(|e| AppError::Io(e.to_string()))?;
            count += 1;
            if count.is_multiple_of(PROGRESS_BATCH) {
                let _ = on_progress.send(ExportProgress { done: count, total });
            }
        }
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(count)
    })
    .await?;

    let _ = on_progress.send(ExportProgress { done: count, total });
    Ok(count)
}

#[tauri::command]
pub async fn export_csv_progress(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    path: String,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let (mut scan_cursor, total) = open_export_cursor(
        state.clone(), &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;
    let report_total = total * 2;

    let mut columns_acc = crate::csv_export::ColumnAccumulator::new();
    let mut scanned: u64 = 0;
    while let Some(d) = scan_cursor.try_next().await? {
        check_cancelled(&cancel)?;
        columns_acc.observe(&d);
        scanned += 1;
        if scanned.is_multiple_of(PROGRESS_BATCH) {
            let _ = on_progress.send(ExportProgress { done: scanned, total: report_total });
        }
    }
    let columns = columns_acc.into_columns();

    let mut write_cursor = open_write_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    let mut w = create_output_writer(p)?;

    let count = cleanup_on_err(p, async {
        let mut count: u64 = 0;
        if total > 0 {
            crate::csv_export::write_header(&mut w, &columns).map_err(|e| AppError::Io(e.to_string()))?;
            while let Some(d) = write_cursor.try_next().await? {
                check_cancelled(&cancel)?;
                crate::csv_export::write_row(&mut w, &columns, &d).map_err(|e| AppError::Io(e.to_string()))?;
                count += 1;
                if count.is_multiple_of(PROGRESS_BATCH) {
                    let _ = on_progress.send(ExportProgress { done: total + count, total: report_total });
                }
            }
        }
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(count)
    })
    .await?;

    let _ = on_progress.send(ExportProgress { done: report_total, total: report_total });
    Ok(count)
}

#[tauri::command]
pub async fn export_sql_progress(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    path: String,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let (mut scan_cursor, total) = open_export_cursor(
        state.clone(), &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;
    let report_total = total * 2;

    let mut schema = crate::sql_export::SqlSchemaAccumulator::new();
    let mut scanned: u64 = 0;
    while let Some(d) = scan_cursor.try_next().await? {
        check_cancelled(&cancel)?;
        schema.observe(&d);
        scanned += 1;
        if scanned.is_multiple_of(PROGRESS_BATCH) {
            let _ = on_progress.send(ExportProgress { done: scanned, total: report_total });
        }
    }
    let (columns, types) = schema.finish();

    let mut write_cursor = open_write_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    let mut w = create_output_writer(p)?;

    let count = cleanup_on_err(p, async {
        let mut count: u64 = 0;
        if total > 0 {
            crate::sql_export::write_create_table(&mut w, &coll, &columns, &types)
                .map_err(|e| AppError::Io(e.to_string()))?;
            while let Some(d) = write_cursor.try_next().await? {
                check_cancelled(&cancel)?;
                crate::sql_export::write_insert(&mut w, &coll, &columns, &d, count == 0)
                    .map_err(|e| AppError::Io(e.to_string()))?;
                count += 1;
                if count.is_multiple_of(PROGRESS_BATCH) {
                    let _ = on_progress.send(ExportProgress { done: total + count, total: report_total });
                }
            }
        }
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(count)
    })
    .await?;

    let _ = on_progress.send(ExportProgress { done: report_total, total: report_total });
    Ok(count)
}

#[tauri::command]
pub async fn export_query_progress(
    session_id: String,
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<Vec<RawDoc>, AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;
    // Fail fast on the counted total; the in-loop guard below still covers a cursor that outgrows it.
    if total > MAX_SHOW_ALL_DOCS {
        return Err(show_all_cap_error(Some(total)));
    }

    let mut docs = Vec::new();
    let mut bytes: usize = 0;
    while let Some(d) = cursor.try_next().await? {
        check_cancelled(&cancel)?;
        if docs.len() as u64 >= MAX_SHOW_ALL_DOCS {
            return Err(show_all_cap_error(None)); // never truncate silently -- a partial set read as complete is worse
        }
        let s = doc_to_raw(d)?;
        bytes += s.get().len();
        if bytes > MAX_SHOW_ALL_BYTES {
            return Err(show_all_byte_cap_error()); // ditto: a handful of oversized docs can blow memory well under the doc-count cap
        }
        docs.push(s);
        if (docs.len() as u64).is_multiple_of(PROGRESS_BATCH) {
            let _ = on_progress.send(ExportProgress { done: docs.len() as u64, total });
        }
    }
    let _ = on_progress.send(ExportProgress { done: docs.len() as u64, total });
    Ok(docs)
}

/// Requests cancellation of any in-flight cancellable op (export progress commands, scripts) on
/// this session -- shares the same per-session cooperative flag as `cancel_script`.
#[tauri::command]
pub async fn cancel_export(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.request_cancel(&session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn import_bson(
    session_id: String,
    db: String,
    coll: String,
    path: String,
    insert_mode: InsertMode,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    state.ensure_writable(&session_id).await?;

    let count_path = path.clone();
    let total = tokio::task::spawn_blocking(move || -> Result<u64, AppError> {
        let file = std::fs::File::open(&count_path).map_err(|e| AppError::Io(e.to_string()))?;
        count_bson_docs_streaming(std::io::BufReader::new(file))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let rx = spawn_bson_producer(path, total);
    consume_import_batches(rx, &collection, insert_mode, total, &on_progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    use mongodb::error::IndexedWriteError;

    fn write_error(index: usize, message: &str) -> IndexedWriteError {
        serde_json::from_str(&format!(r#"{{"index":{index},"code":11000,"errmsg":"{message}"}}"#)).unwrap()
    }

    #[test]
    fn insert_mode_deserializes_from_camel_case_wire_values() {
        assert_eq!(serde_json::from_str::<InsertMode>("\"skipDuplicates\"").unwrap(), InsertMode::SkipDuplicates);
        assert_eq!(serde_json::from_str::<InsertMode>("\"upsertById\"").unwrap(), InsertMode::UpsertById);
        assert_eq!(serde_json::from_str::<InsertMode>("\"stopOnFirstError\"").unwrap(), InsertMode::StopOnFirstError);
    }

    #[test]
    fn apply_unordered_write_errors_remaps_batch_index_to_the_original_raw_index() {
        // Unordered writes: the server attempts every document in the batch regardless of an
        // earlier one failing, so "inserted" = batch_len - error_count holds.
        let we = vec![write_error(1, "E11000 duplicate key")];
        let raw_idx = vec![10, 11, 12]; // this batch's 3 docs came from file rows 10, 11, 12
        let mut inserted = 0u64;
        let mut errors = Vec::new();
        apply_unordered_write_errors(&we, &raw_idx, 3, &mut inserted, &mut errors);
        assert_eq!(inserted, 2);
        assert_eq!(errors, vec!["doc#11: E11000 duplicate key".to_string()]);
    }

    #[test]
    fn apply_unordered_write_errors_handles_multiple_failures_in_one_batch() {
        let we = vec![write_error(0, "dup a"), write_error(2, "dup c")];
        let raw_idx = vec![5, 6, 7];
        let mut inserted = 0u64;
        let mut errors = Vec::new();
        apply_unordered_write_errors(&we, &raw_idx, 3, &mut inserted, &mut errors);
        assert_eq!(inserted, 1);
        assert_eq!(errors, vec!["doc#5: dup a".to_string(), "doc#7: dup c".to_string()]);
    }

    #[test]
    fn apply_ordered_write_error_only_counts_documents_strictly_before_the_failing_index() {
        // Ordered write: the server stops at the first failure, so index 2 failing means exactly
        // 2 documents (index 0, 1) actually landed — not batch_len - 1.
        let we = write_error(2, "E11000 duplicate key");
        let raw_idx = vec![100, 101, 102, 103]; // batch had 4 docs; only 3 were attempted before the stop
        let mut inserted = 0u64;
        let mut errors = Vec::new();
        apply_ordered_write_error(&we, &raw_idx, &mut inserted, &mut errors);
        assert_eq!(inserted, 2);
        assert_eq!(errors, vec!["doc#102: E11000 duplicate key".to_string()]);
    }

    #[test]
    fn apply_ordered_write_error_handles_the_first_document_failing_immediately() {
        let we = write_error(0, "bad doc");
        let raw_idx = vec![7, 8, 9];
        let mut inserted = 0u64;
        let mut errors = Vec::new();
        apply_ordered_write_error(&we, &raw_idx, &mut inserted, &mut errors);
        assert_eq!(inserted, 0);
        assert_eq!(errors, vec!["doc#7: bad doc".to_string()]);
    }

    #[test]
    fn summarize_import_no_errors() {
        let r = summarize_import(3, vec![]);
        assert_eq!(r.inserted, 3);
        assert_eq!(r.failed, 0);
        assert!(r.errors.is_empty());
    }

    #[test]
    fn summarize_import_truncates_to_max() {
        let errs: Vec<String> = (0..7).map(|i| format!("e{i}")).collect();
        let r = summarize_import(2, errs);
        assert_eq!(r.inserted, 2);
        assert_eq!(r.failed, 7);
        assert_eq!(r.errors.len(), MAX_IMPORT_ERRORS);
        assert_eq!(r.errors[0], "e0");
    }

    #[test]
    fn write_text_file_creates_dirs_and_writes() {
        let dir = std::env::temp_dir().join("monglumio_test_export_write");
        let path = dir.join("nested").join("out.json");
        let _ = std::fs::remove_dir_all(&dir);
        write_text_file(path.to_string_lossy().to_string(), "hello world".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello world");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_file_size_returns_the_files_byte_length() {
        let dir = std::env::temp_dir().join("monglumio_test_import_file_size");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("data.json");
        std::fs::write(&path, b"0123456789").unwrap();
        let size = import_file_size(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(size, 10);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_file_size_reports_io_error_for_a_missing_path() {
        let dir = std::env::temp_dir().join("monglumio_test_import_file_size_missing");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("nope.json");
        assert!(matches!(
            import_file_size(path.to_string_lossy().to_string()),
            Err(AppError::Io(_))
        ));
    }

    #[test]
    fn read_text_file_if_exists_returns_none_for_a_missing_path() {
        let dir = std::env::temp_dir().join("monglumio_test_read_if_exists_missing");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("nope.metadata.json");
        assert_eq!(
            read_text_file_if_exists(path.to_string_lossy().to_string()).unwrap(),
            None
        );
    }

    #[test]
    fn read_text_file_if_exists_returns_contents_when_present() {
        let dir = std::env::temp_dir().join("monglumio_test_read_if_exists_present");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.metadata.json");
        std::fs::write(&path, "{}").unwrap();
        assert_eq!(
            read_text_file_if_exists(path.to_string_lossy().to_string()).unwrap(),
            Some("{}".to_string())
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_array_framing_roundtrips() {
        fn frame(docs: &[&str]) -> String {
            let mut buf: Vec<u8> = Vec::new();
            for (i, d) in docs.iter().enumerate() {
                write_json_array_element(&mut buf, d, i == 0).unwrap();
            }
            finish_json_array(&mut buf, !docs.is_empty()).unwrap();
            String::from_utf8(buf).unwrap()
        }
        assert_eq!(frame(&[]), "[]");
        assert_eq!(frame(&["{\"a\":1}"]), "[\n{\"a\":1}\n]");
        assert_eq!(frame(&["{\"a\":1}", "{\"b\":2}"]), "[\n{\"a\":1},\n{\"b\":2}\n]");
        // shipped framing must be valid JSON
        for case in [frame(&[]), frame(&["{\"a\":1}"]), frame(&["{\"a\":1}", "{\"b\":2}"])] {
            serde_json::from_str::<serde_json::Value>(&case).unwrap();
        }
    }
}
