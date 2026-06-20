use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_bson, canonical_string_to_doc};
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use mongodb::error::ErrorKind;
use tauri::State;

/// Dựng pipeline lấy mẫu schema, áp filter người dùng nếu có.
/// Filter rỗng → chỉ `$sample`; có filter → `$match` trước rồi `$sample`.
fn build_sample_pipeline(user: Document, size: i64) -> Vec<Document> {
    if user.is_empty() {
        vec![doc! { "$sample": { "size": size } }]
    } else {
        vec![doc! { "$match": user }, doc! { "$sample": { "size": size } }]
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn query_page(
    db: String,
    coll: String,
    skip: i64,                  // skip/limit paging (1-based page → skip ở FE)
    limit: i64,
    filter: Option<String>,
    sort: Option<String>,       // ExtJSON doc CÓ THỨ TỰ, vd {"age":-1,"_id":1}; rỗng → {_id:1}
    projection: Option<String>, // ExtJSON exclusion doc, vd {"big":0}
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = match filter.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => Document::new(),
    };
    let sort_doc = match sort.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => doc! { "_id": 1 },
    };

    let mut q = collection
        .find(user_filter)
        .sort(sort_doc)
        .skip(skip.max(0) as u64)
        .limit(limit);
    if let Some(s) = projection.as_deref() {
        if !s.trim().is_empty() {
            q = q.projection(canonical_string_to_doc(s)?);
        }
    }
    let mut cursor = q.await?;

    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(&d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn sample_documents(
    db: String,
    coll: String,
    filter: Option<String>,
    size: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = match filter.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => Document::new(),
    };

    let pipeline = build_sample_pipeline(user_filter, size);

    let mut cursor = collection.aggregate(pipeline).await?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(&d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn insert_document(
    db: String,
    coll: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client().await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.insert_one(new_doc).await?;
    bson_to_canonical_string(&res.inserted_id)
}

/// Reject a replacement whose embedded _id differs from the original (immutable _id).
fn ensure_id_unchanged(
    new_doc: &mongodb::bson::Document,
    id: &mongodb::bson::Bson,
) -> Result<(), AppError> {
    if let Some(new_id) = new_doc.get("_id") {
        if new_id != id {
            return Err(AppError::Query("không được đổi _id".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn replace_document(
    db: String,
    coll: String,
    id_json: String,
    doc_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let id_bson = canonical_string_to_bson(&id_json)?;

    // _id is immutable: reject if the edited document carries a different _id.
    ensure_id_unchanged(&new_doc, &id_bson)?;

    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection
        .replace_one(doc! { "_id": id_bson }, new_doc)
        .await?;
    if res.matched_count == 0 {
        return Err(AppError::Query("document không còn tồn tại".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_document(
    db: String,
    coll: String,
    id_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client().await?;

    let id_bson = canonical_string_to_bson(&id_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.delete_one(doc! { "_id": id_bson }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::Query("không tìm thấy document để xóa".into()));
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct BulkResult {
    pub matched: u64,
    pub modified: u64,
}

const MAX_IMPORT_ERRORS: usize = 5;

#[derive(serde::Serialize)]
pub struct ImportResult {
    pub inserted: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

/// Tách nội dung file thành danh sách chuỗi ExtJSON từng-doc.
/// Ký tự non-whitespace đầu là '[' → parse mảng JSON, mỗi phần tử serialize lại 1 chuỗi.
/// Ngược lại → JSONL: mỗi dòng non-empty (sau trim) là một doc.
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

/// Dựng ImportResult từ số đã chèn + danh sách thông điệp lỗi, giữ tối đa MAX_IMPORT_ERRORS lỗi đầu.
fn summarize_import(inserted: u64, mut errors: Vec<String>) -> ImportResult {
    let failed = errors.len() as u64;
    errors.truncate(MAX_IMPORT_ERRORS);
    ImportResult { inserted, failed, errors }
}

/// Parse filter ExtJSON người dùng (rỗng/None → Document rỗng).
fn parse_user_filter(filter: Option<&str>) -> Result<Document, AppError> {
    match filter {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s),
        _ => Ok(Document::new()),
    }
}

#[tauri::command]
pub async fn count_documents(
    db: String,
    coll: String,
    filter: Option<String>,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    Ok(collection.count_documents(f).await?)
}

#[tauri::command]
pub async fn update_many(
    db: String,
    coll: String,
    filter: Option<String>,
    update: String,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<BulkResult, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    ensure_filter_allowed(&f, allow_all)?;
    let update_doc = canonical_string_to_doc(&update)?;
    let res = collection.update_many(f, update_doc).await?;
    Ok(BulkResult {
        matched: res.matched_count,
        modified: res.modified_count,
    })
}

#[tauri::command]
pub async fn delete_many(
    db: String,
    coll: String,
    filter: Option<String>,
    allow_all: bool,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let f = parse_user_filter(filter.as_deref())?;
    ensure_filter_allowed(&f, allow_all)?;
    let res = collection.delete_many(f).await?;
    Ok(res.deleted_count)
}

/// Chặn thao tác bulk phá hủy trên filter rỗng trừ khi đã xác nhận tường minh.
fn ensure_filter_allowed(filter: &Document, allow_all: bool) -> Result<(), AppError> {
    if filter.is_empty() && !allow_all {
        return Err(AppError::Query(
            "filter rỗng: cần xác nhận để áp dụng cho toàn bộ collection".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn export_query(
    db: String,
    coll: String,
    filter: Option<String>,
    sort: Option<String>,
    projection: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let user_filter = parse_user_filter(filter.as_deref())?;
    let sort_doc = match sort.as_deref() {
        Some(s) if !s.trim().is_empty() => canonical_string_to_doc(s)?,
        _ => doc! { "_id": 1 },
    };

    let mut q = collection.find(user_filter).sort(sort_doc);
    if let Some(s) = projection.as_deref() {
        if !s.trim().is_empty() {
            q = q.projection(canonical_string_to_doc(s)?);
        }
    }
    let mut cursor = q.await?;

    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(&d)?);
    }
    Ok(docs)
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

    let valid = parsed.len() as u64;
    if parsed.is_empty() {
        return Ok(summarize_import(0, errors));
    }

    let client = state.client().await?;
    let collection = client.database(&db).collection::<Document>(&coll);

    let inserted = match collection.insert_many(parsed).ordered(false).await {
        Ok(res) => res.inserted_ids.len() as u64,
        Err(e) => {
            // Clone the owned write-error list first so the borrow of `*e.kind` ends
            // before we may consume `e` via `e.into()` in the fall-through arm.
            let write_errors = match &*e.kind {
                ErrorKind::InsertMany(ime) => ime.write_errors.clone(),
                _ => None,
            };
            match write_errors {
                Some(we) => {
                    for w in &we {
                        // Remap batch index → raw input index so both error types share one index space.
                        let raw = parsed_raw_idx.get(w.index).copied().unwrap_or(w.index);
                        errors.push(format!("doc#{raw}: {}", w.message));
                    }
                    valid.saturating_sub(we.len() as u64)
                }
                None => return Err(e.into()),
            }
        }
    };

    Ok(summarize_import(inserted, errors))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, Bson};

    #[test]
    fn matching_id_is_ok() {
        let oid = ObjectId::new();
        let id = Bson::ObjectId(oid);
        let new_doc = doc! { "_id": oid, "name": "alice" };
        assert!(ensure_id_unchanged(&new_doc, &id).is_ok());
    }

    #[test]
    fn different_id_is_rejected() {
        let id = Bson::ObjectId(ObjectId::new());
        let new_doc = doc! { "_id": ObjectId::new(), "name": "alice" };
        let res = ensure_id_unchanged(&new_doc, &id);
        assert!(matches!(res, Err(AppError::Query(_))));
    }

    #[test]
    fn omitted_id_is_ok() {
        let id = Bson::ObjectId(ObjectId::new());
        let new_doc = doc! { "name": "alice" };
        assert!(ensure_id_unchanged(&new_doc, &id).is_ok());
    }

    #[test]
    fn sample_pipeline_without_filter_is_sample_only() {
        let out = build_sample_pipeline(Document::new(), 100);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], doc! { "$sample": { "size": 100_i64 } });
    }

    #[test]
    fn sample_pipeline_with_filter_matches_then_samples() {
        let user = doc! { "status": "active" };
        let out = build_sample_pipeline(user.clone(), 50);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], doc! { "$match": user });
        assert_eq!(out[1], doc! { "$sample": { "size": 50_i64 } });
    }

    #[test]
    fn empty_filter_without_allow_is_rejected() {
        let res = ensure_filter_allowed(&Document::new(), false);
        assert!(matches!(res, Err(AppError::Query(_))));
    }

    #[test]
    fn empty_filter_with_allow_is_ok() {
        assert!(ensure_filter_allowed(&Document::new(), true).is_ok());
    }

    #[test]
    fn non_empty_filter_is_ok_without_allow() {
        let f = doc! { "status": "active" };
        assert!(ensure_filter_allowed(&f, false).is_ok());
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
}
