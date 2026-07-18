use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::Document;
use mongodb::error::ErrorKind;
use mongodb::Cursor;
use std::io::Write;
use tauri::{ipc::Channel, State};

use super::query::build_find_options;

const MAX_IMPORT_ERRORS: usize = 5;
const PROGRESS_BATCH: u64 = 1000;

#[derive(serde::Serialize, Clone)]
pub struct ExportProgress {
    pub done: u64,
    pub total: u64,
}

/// Shared setup for the `export_*` commands: open the sorted (optionally projected) cursor over matching documents and return it with the total match count.
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
    let total = collection.count_documents(filter_doc.clone()).await?;
    let mut q = collection.find(filter_doc).sort(sort_doc);
    if let Some(p) = proj_doc {
        q = q.projection(p);
    }
    Ok((q.await?, total))
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

/// Split file content into per-document ExtJSON strings: a leading `[` parses as a JSON array, otherwise JSONL (one document per non-empty line).
fn split_import(content: &str) -> Result<Vec<String>, AppError> {
    if content.trim_start().starts_with('[') {
        let arr: Vec<serde_json::Value> =
            serde_json::from_str(content).map_err(|e| AppError::Parse(e.to_string()))?;
        arr.into_iter()
            .map(|v| serde_json::to_string(&v).map_err(|e| AppError::Parse(e.to_string())))
            .collect()
    } else {
        Ok(content
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect())
    }
}

/// Build an ImportResult from an inserted count and error messages, capping errors at MAX_IMPORT_ERRORS.
pub(crate) fn summarize_import(inserted: u64, mut errors: Vec<String>) -> ImportResult {
    let failed = errors.len() as u64;
    errors.truncate(MAX_IMPORT_ERRORS);
    ImportResult { inserted, failed, errors }
}

/// Shared by every import path (`import_documents`, `import_bson`, `sql_import_commit`,
/// `csv_import_commit`) so the user picks one behavior regardless of file format. Default is
/// `SkipDuplicates` — no behavior change for a caller that doesn't surface the other two.
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

/// Folds an **unordered** `insert_many`'s write errors into `inserted`/`errors`: every document in
/// the batch was attempted regardless of another one failing, so `inserted` grows by
/// `batch_len - write_errors.len()`. Each error's batch-local index is remapped back to its
/// original file/row index via `raw_idx[index]`.
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

/// Folds an **ordered** `insert_many`'s single write error into `inserted`/`errors`: the server
/// stops at the first failure, so only the documents strictly before `write_error.index` actually
/// landed — unlike the unordered case, `batch_len - 1` would overcount (documents after the
/// failure were never attempted, not merely rejected).
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

/// Insert one already-parsed batch under the chosen `mode`, remapping write-errors back to each
/// doc's original raw file/row index (`raw_idx[k]` = original index of `batch[k]`). Returns
/// `true` when the caller should stop pulling further batches — only possible for
/// `StopOnFirstError` after it hits a write error; the other two modes always return `false` and
/// let the caller keep going (a `SkipDuplicates`/`UpsertById` per-doc failure is recorded but never
/// halts the rest of the import).
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

async fn upsert_by_id(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    for (doc, &raw) in batch.iter().zip(raw_idx.iter()) {
        let Some(id) = doc.get("_id") else {
            errors.push(format!("doc#{raw}: upsert requires an _id field"));
            continue;
        };
        let filter = mongodb::bson::doc! { "_id": id.clone() };
        match collection.replace_one(filter, doc.clone()).upsert(true).await {
            Ok(_) => *inserted += 1,
            Err(e) => errors.push(format!("doc#{raw}: {e}")),
        }
    }
}

/// Parse and insert already-split ExtJSON doc strings in `PROGRESS_BATCH`-sized chunks, so at most one
/// batch's worth of parsed BSON is held in memory at a time (a large import file no longer holds every
/// parsed document simultaneously — same OOM class as the QuickJS unbounded-batch bug, see
/// bugfix-2026-07-08 memory).
async fn parse_and_insert(
    collection: &mongodb::Collection<Document>,
    raw_docs: &[String],
    mode: InsertMode,
    on_progress: &Channel<ExportProgress>,
) -> ImportResult {
    let total = raw_docs.len() as u64;
    let mut inserted: u64 = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut done: u64 = 0;

    for chunk in raw_docs.chunks(PROGRESS_BATCH as usize) {
        let raw_start = done as usize;
        let mut parsed: Vec<Document> = Vec::with_capacity(chunk.len());
        let mut raw_idx: Vec<usize> = Vec::with_capacity(chunk.len());
        for (i, s) in chunk.iter().enumerate() {
            match canonical_string_to_doc(s) {
                Ok(d) => {
                    parsed.push(d);
                    raw_idx.push(raw_start + i);
                }
                Err(e) => errors.push(format!("doc#{}: {e}", raw_start + i)),
            }
        }
        let mut stop = false;
        if !parsed.is_empty() {
            stop = insert_batch(collection, parsed, &raw_idx, mode, &mut inserted, &mut errors).await;
        }
        done += chunk.len() as u64;
        let _ = on_progress.send(ExportProgress { done, total });
        if stop {
            break;
        }
    }
    summarize_import(inserted, errors)
}

/// Count concatenated BSON documents (mongodump-style) without deserializing them — each document starts
/// with a little-endian i32 total length, so we can skip over it to find the next boundary.
fn count_bson_docs(mut bytes: &[u8]) -> Result<u64, AppError> {
    let mut n = 0u64;
    while !bytes.is_empty() {
        if bytes.len() < 4 {
            return Err(AppError::Parse("truncated BSON document".into()));
        }
        let len = i32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
        if len < 4 || len > bytes.len() {
            return Err(AppError::Parse("invalid BSON document length".into()));
        }
        bytes = &bytes[len..];
        n += 1;
    }
    Ok(n)
}

/// Parse and insert concatenated BSON documents (mongodump-style) in `PROGRESS_BATCH`-sized chunks, so at
/// most one batch's worth of parsed docs is held in memory at a time.
async fn parse_and_insert_bson(
    collection: &mongodb::Collection<Document>,
    bytes: &[u8],
    mode: InsertMode,
    on_progress: &Channel<ExportProgress>,
) -> Result<ImportResult, AppError> {
    let total = count_bson_docs(bytes)?;
    let mut cursor = bytes;
    let mut inserted: u64 = 0;
    let mut errors: Vec<String> = Vec::new();
    let mut done: u64 = 0;

    while !cursor.is_empty() {
        let batch_start = done as usize;
        let mut batch: Vec<Document> = Vec::new();
        while batch.len() < PROGRESS_BATCH as usize && !cursor.is_empty() {
            let d = Document::from_reader(&mut cursor).map_err(|e| AppError::Parse(e.to_string()))?;
            batch.push(d);
        }
        let batch_len = batch.len();
        let raw_idx: Vec<usize> = (batch_start..batch_start + batch_len).collect();
        let stop = insert_batch(collection, batch, &raw_idx, mode, &mut inserted, &mut errors).await;
        done += batch_len as u64;
        let _ = on_progress.send(ExportProgress { done, total });
        if stop {
            break;
        }
    }
    Ok(summarize_import(inserted, errors))
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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn import_documents(
    session_id: String,
    db: String,
    coll: String,
    path: String,
    insert_mode: InsertMode,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    // Sync file I/O runs on a blocking thread so it doesn't stall the tokio worker other sessions share.
    let raw_docs = tokio::task::spawn_blocking(move || -> Result<Vec<String>, AppError> {
        let content = std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
        split_import(&content)
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    Ok(parse_and_insert(&collection, &raw_docs, insert_mode, &on_progress).await)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let file = std::fs::File::create(p).map_err(|e| AppError::Io(e.to_string()))?;
    let mut w = std::io::BufWriter::new(file);
    let mut count: u64 = 0;
    while let Some(d) = cursor.try_next().await? {
        let s = doc_to_canonical_string(d)?;
        write_json_array_element(&mut w, &s, count == 0).map_err(|e| AppError::Io(e.to_string()))?;
        count += 1;
        if count % PROGRESS_BATCH == 0 {
            let _ = on_progress.send(ExportProgress { done: count, total });
        }
    }
    finish_json_array(&mut w, count > 0).map_err(|e| AppError::Io(e.to_string()))?;
    w.flush().map_err(|e| AppError::Io(e.to_string()))?;
    let _ = on_progress.send(ExportProgress { done: count, total });
    Ok(count)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let p = std::path::Path::new(&path);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let file = std::fs::File::create(p).map_err(|e| AppError::Io(e.to_string()))?;
    let mut w = std::io::BufWriter::new(file);
    let mut count: u64 = 0;
    while let Some(d) = cursor.try_next().await? {
        let bytes = mongodb::bson::to_vec(&d).map_err(|e| AppError::Parse(e.to_string()))?;
        w.write_all(&bytes).map_err(|e| AppError::Io(e.to_string()))?;
        count += 1;
        if count % PROGRESS_BATCH == 0 {
            let _ = on_progress.send(ExportProgress { done: count, total });
        }
    }
    w.flush().map_err(|e| AppError::Io(e.to_string()))?;
    let _ = on_progress.send(ExportProgress { done: count, total });
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
) -> Result<Vec<String>, AppError> {
    let (mut cursor, total) = open_export_cursor(
        state, &session_id, &db, &coll,
        filter.as_deref(), sort.as_deref(), projection.as_deref(),
    )
    .await?;

    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(d)?);
        if docs.len() as u64 % PROGRESS_BATCH == 0 {
            let _ = on_progress.send(ExportProgress { done: docs.len() as u64, total });
        }
    }
    let _ = on_progress.send(ExportProgress { done: docs.len() as u64, total });
    Ok(docs)
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
    let bytes = tokio::task::spawn_blocking(move || {
        std::fs::read(&path).map_err(|e| AppError::Io(e.to_string()))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    parse_and_insert_bson(&collection, &bytes, insert_mode, &on_progress).await
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
    fn split_import_parses_json_array() {
        let out = split_import(r#"[{"a":1},{"b":2}]"#).unwrap();
        assert_eq!(out.len(), 2);
        // each element is a standalone JSON object string
        assert!(out[0].contains("\"a\""));
        assert!(out[1].contains("\"b\""));
    }

    #[test]
    fn split_import_accepts_leading_whitespace_array() {
        let out = split_import("  \n  [ {\"a\":1} ]").unwrap();
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn split_import_parses_jsonl_skipping_blank_lines() {
        let out = split_import("{\"a\":1}\n\n{\"b\":2}\n").unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].contains("\"a\""));
        assert!(out[1].contains("\"b\""));
    }

    #[test]
    fn split_import_rejects_malformed_array() {
        assert!(matches!(split_import("[{"), Err(AppError::Parse(_))));
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
    fn count_bson_docs_counts_concatenated_documents() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let b = mongodb::bson::to_vec(&doc! {"b": 2}).unwrap();
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        assert_eq!(count_bson_docs(&buf).unwrap(), 2);
    }

    #[test]
    fn count_bson_docs_rejects_truncated_buffer() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let truncated = &a[..a.len() - 2];
        assert!(matches!(count_bson_docs(truncated), Err(AppError::Parse(_))));
    }

    #[test]
    fn parsed_bson_docs_roundtrip_via_document_from_reader() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let b = mongodb::bson::to_vec(&doc! {"b": 2}).unwrap();
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        let mut cursor: &[u8] = &buf;
        let first = Document::from_reader(&mut cursor).unwrap();
        let second = Document::from_reader(&mut cursor).unwrap();
        assert_eq!(first.get_i32("a").unwrap(), 1);
        assert_eq!(second.get_i32("b").unwrap(), 2);
        assert!(cursor.is_empty());
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
