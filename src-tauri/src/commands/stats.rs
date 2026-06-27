use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
use tauri::State;

#[tauri::command]
pub async fn coll_stats(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    // The `collStats` run_command is deprecated; use the $collStats aggregation stage instead.
    // $collStats nests metrics under `storageStats` (size, count, storageSize, indexSizes...).
    // Flatten to top-level to match the shape expected by the frontend (domain/stats.ts).
    let pipeline = vec![doc! { "$collStats": { "storageStats": {} } }];
    let mut cursor = client
        .database(&db)
        .collection::<Document>(&coll)
        .aggregate(pipeline)
        .await?;
    let first = cursor
        .try_next()
        .await?
        .ok_or_else(|| AppError::Query("$collStats: no result".into()))?;

    // Flatten: ns at top-level; remaining metrics pulled from storageStats.
    let mut out = first
        .get_document("storageStats")
        .cloned()
        .unwrap_or_default();
    if let Some(ns) = first.get("ns") {
        out.insert("ns", ns.clone());
    }
    doc_to_canonical_string(out)
}

#[tauri::command]
pub async fn db_stats(
    session_id: String,
    db: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let resp = client
        .database(&db)
        .run_command(doc! { "dbStats": 1 })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn coll_options(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    // listCollections returns { cursor: { firstBatch: [ { name, type, options, info, idIndex } ] } }.
    let resp = client
        .database(&db)
        .run_command(doc! { "listCollections": 1, "filter": { "name": &coll } })
        .await?;
    let first = resp
        .get_document("cursor")
        .and_then(|c| c.get_array("firstBatch"))
        .map_err(|e| AppError::Query(format!("listCollections: invalid response: {e}")))?
        .first()
        .and_then(|b| b.as_document());
    match first {
        Some(d) => doc_to_canonical_string(d.clone()),
        None => Ok("{}".to_string()), // collection does not exist → empty options
    }
}
