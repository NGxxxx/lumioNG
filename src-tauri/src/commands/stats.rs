use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use tauri::State;

#[tauri::command]
pub async fn coll_stats(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client().await?;
    // `collStats` (run_command) đã deprecated → dùng aggregation $collStats.
    // $collStats lồng số liệu trong `storageStats` (size, count, storageSize, indexSizes...).
    // Ta phẳng hóa về top-level để giữ NGUYÊN hình dạng JSON cho frontend (domain/stats.ts).
    let pipeline = vec![doc! { "$collStats": { "storageStats": {} } }];
    let mut cursor = client
        .database(&db)
        .collection::<Document>(&coll)
        .aggregate(pipeline)
        .await?;
    let first = cursor
        .try_next()
        .await?
        .ok_or_else(|| AppError::Query("$collStats: không có kết quả".into()))?;

    // Phẳng: ns ở top-level; số liệu còn lại lấy từ storageStats.
    let mut out = first
        .get_document("storageStats")
        .cloned()
        .unwrap_or_default();
    if let Some(ns) = first.get("ns") {
        out.insert("ns", ns.clone());
    }
    doc_to_canonical_string(&out)
}

#[tauri::command]
pub async fn db_stats(db: String, state: State<'_, AppState>) -> Result<String, AppError> {
    let client = state.client().await?;
    let resp = client
        .database(&db)
        .run_command(doc! { "dbStats": 1 })
        .await?;
    doc_to_canonical_string(&resp)
}

#[tauri::command]
pub async fn coll_options(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client().await?;
    // listCollections trả { cursor: { firstBatch: [ { name, type, options, info, idIndex } ] } }.
    let resp = client
        .database(&db)
        .run_command(doc! { "listCollections": 1, "filter": { "name": &coll } })
        .await?;
    let first = resp
        .get_document("cursor")
        .and_then(|c| c.get_array("firstBatch"))
        .map_err(|e| AppError::Query(format!("listCollections: phản hồi không hợp lệ: {e}")))?
        .first()
        .and_then(|b| b.as_document());
    match first {
        Some(d) => doc_to_canonical_string(d),
        None => Ok("{}".to_string()), // collection không tồn tại → options rỗng
    }
}
