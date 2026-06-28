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

/// Shared setup for the `export_*` commands: open the sorted (optionally projected)
/// cursor over the matching documents and return it with the total match count.
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

/// Write one element into a streaming JSON-array body: opening `[` + newline for the
/// first element, `,` + newline before each subsequent one, then the document JSON.
fn write_json_array_element<W: Write>(w: &mut W, doc_json: &str, first: bool) -> std::io::Result<()> {
    w.write_all(if first { b"[\n" } else { b",\n" })?;
    w.write_all(doc_json.as_bytes())
}
/// Close a streaming JSON-array body. `any` = at least one element was written
/// (empty array is written as `[]`).
fn finish_json_array<W: Write>(w: &mut W, any: bool) -> std::io::Result<()> {
    w.write_all(if any { b"\n]" } else { b"[]" })
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub inserted: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// Split file content into a list of per-document ExtJSON strings.
/// Leading non-whitespace is '[' → parse as JSON array, re-serialize each element.
/// Otherwise → JSONL: each non-empty trimmed line is one document.
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
fn summarize_import(inserted: u64, mut errors: Vec<String>) -> ImportResult {
    let failed = errors.len() as u64;
    errors.truncate(MAX_IMPORT_ERRORS);
    ImportResult { inserted, failed, errors }
}

/// Parse concatenated BSON documents (mongodump-style) until EOF.
fn read_bson_docs(mut bytes: &[u8]) -> Result<Vec<Document>, AppError> {
    let mut out = Vec::new();
    while !bytes.is_empty() {
        let d = Document::from_reader(&mut bytes).map_err(|e| AppError::Parse(e.to_string()))?;
        out.push(d);
    }
    Ok(out)
}

/// Insert pre-parsed docs unordered; remap batch write-errors to raw indices; summarize.
async fn insert_parsed(
    collection: &mongodb::Collection<Document>,
    parsed: Vec<Document>,
    parsed_raw_idx: Vec<usize>,
    mut errors: Vec<String>,
) -> ImportResult {
    let valid = parsed.len() as u64;
    if parsed.is_empty() {
        return summarize_import(0, errors);
    }
    let inserted = match collection.insert_many(parsed).ordered(false).await {
        Ok(res) => res.inserted_ids.len() as u64,
        Err(e) => {
            let write_errors = match &*e.kind {
                ErrorKind::InsertMany(ime) => ime.write_errors.clone(),
                _ => None,
            };
            match write_errors {
                Some(we) => {
                    for w in &we {
                        let raw = parsed_raw_idx.get(w.index).copied().unwrap_or(w.index);
                        errors.push(format!("doc#{raw}: {}", w.message));
                    }
                    valid.saturating_sub(we.len() as u64)
                }
                None => {
                    // Plan-mandated: non-write errors are recorded into `errors`, not propagated (keeps the helper infallible and consistent with BSON import).
                    errors.push(e.to_string());
                    0
                }
            }
        }
    };
    summarize_import(inserted, errors)
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
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let content = std::fs::read_to_string(&path).map_err(|e| AppError::Io(e.to_string()))?;
    let raw_docs = split_import(&content)?;

    let mut errors: Vec<String> = Vec::new();
    let mut parsed: Vec<Document> = Vec::new();
    // Parallel vec: parsed_raw_idx[k] = index in raw_docs of the k-th successfully-parsed doc.
    let mut parsed_raw_idx: Vec<usize> = Vec::new();
    for (i, s) in raw_docs.iter().enumerate() {
        match canonical_string_to_doc(s) {
            Ok(d) => {
                parsed.push(d);
                parsed_raw_idx.push(i);
            }
            Err(e) => errors.push(format!("doc#{i}: {e}")),
        }
    }

    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    Ok(insert_parsed(&collection, parsed, parsed_raw_idx, errors).await)
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
    state: State<'_, AppState>,
) -> Result<ImportResult, AppError> {
    let bytes = std::fs::read(&path).map_err(|e| AppError::Io(e.to_string()))?;
    let parsed = read_bson_docs(&bytes)?;
    let parsed_raw_idx: Vec<usize> = (0..parsed.len()).collect();
    let client = state.client(&session_id).await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    Ok(insert_parsed(&collection, parsed, parsed_raw_idx, Vec::new()).await)
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
    fn read_bson_docs_roundtrips_concatenation() {
        use mongodb::bson::doc;
        let a = mongodb::bson::to_vec(&doc! {"a": 1}).unwrap();
        let b = mongodb::bson::to_vec(&doc! {"b": 2}).unwrap();
        let mut buf = a.clone();
        buf.extend_from_slice(&b);
        let docs = read_bson_docs(&buf).unwrap();
        assert_eq!(docs.len(), 2);
        assert_eq!(docs[0].get_i32("a").unwrap(), 1);
        assert_eq!(docs[1].get_i32("b").unwrap(), 2);
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
