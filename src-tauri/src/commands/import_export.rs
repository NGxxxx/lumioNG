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

/// Insert one already-parsed batch, remapping write-errors back to each doc's original raw file index (`raw_idx[k]` = file index of `batch[k]`).
pub(crate) async fn insert_batch(
    collection: &mongodb::Collection<Document>,
    batch: Vec<Document>,
    raw_idx: &[usize],
    inserted: &mut u64,
    errors: &mut Vec<String>,
) {
    let batch_len = batch.len() as u64;
    match collection.insert_many(batch).ordered(false).await {
        Ok(res) => *inserted += res.inserted_ids.len() as u64,
        Err(e) => {
            let write_errors = match &*e.kind {
                ErrorKind::InsertMany(ime) => ime.write_errors.clone(),
                _ => None,
            };
            match write_errors {
                Some(we) => {
                    for w in &we {
                        let raw = raw_idx.get(w.index).copied().unwrap_or(w.index);
                        errors.push(format!("doc#{raw}: {}", w.message));
                    }
                    *inserted += batch_len.saturating_sub(we.len() as u64);
                }
                None => {
                    // Plan-mandated: non-write errors are recorded into `errors`, not propagated (keeps the helper infallible and consistent with BSON import).
                    errors.push(e.to_string());
                }
            }
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
        if !parsed.is_empty() {
            insert_batch(collection, parsed, &raw_idx, &mut inserted, &mut errors).await;
        }
        done += chunk.len() as u64;
        let _ = on_progress.send(ExportProgress { done, total });
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
        insert_batch(collection, batch, &raw_idx, &mut inserted, &mut errors).await;
        done += batch_len as u64;
        let _ = on_progress.send(ExportProgress { done, total });
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

#[tauri::command]
pub async fn import_documents(
    session_id: String,
    db: String,
    coll: String,
    path: String,
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
    Ok(parse_and_insert(&collection, &raw_docs, &on_progress).await)
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
    parse_and_insert_bson(&collection, &bytes, &on_progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

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
