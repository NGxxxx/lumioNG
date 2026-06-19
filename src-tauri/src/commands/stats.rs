use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use mongodb::bson::doc;
use tauri::State;

#[tauri::command]
pub async fn coll_stats(
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client().await?;
    // collStats trả thẳng doc số liệu ở top-level (count, size, storageSize, indexSizes...).
    let resp = client
        .database(&db)
        .run_command(doc! { "collStats": &coll })
        .await?;
    doc_to_canonical_string(&resp)
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
