use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc;
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use mongodb::options::{Collation, IndexOptions};
use mongodb::IndexModel;
use std::time::Duration;
use tauri::State;

#[tauri::command]
pub async fn list_indexes(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    // listIndexes returns { cursor: { firstBatch: [ <index doc>... ] } }.
    let resp = client
        .database(&db)
        .run_command(doc! { "listIndexes": &coll })
        .await?;
    let batch = resp
        .get_document("cursor")
        .and_then(|c| c.get_array("firstBatch"))
        .map_err(|e| AppError::Query(format!("listIndexes: invalid response: {e}")))?;
    let mut out = Vec::new();
    for b in batch {
        if let Some(d) = b.as_document() {
            out.push(doc_to_canonical_string(d.clone())?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn create_index(
    session_id: String,
    db: String,
    coll: String,
    keys: String,
    unique: bool,
    name: Option<String>,
    sparse: bool,
    ttl_seconds: Option<i64>,
    partial_filter: Option<String>,
    collation: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    let keys_doc = canonical_string_to_doc(&keys)?;
    let partial_filter_doc = partial_filter
        .as_deref()
        .map(canonical_string_to_doc)
        .transpose()?;
    let collation_opt = collation
        .as_deref()
        .map(canonical_string_to_doc)
        .transpose()?
        .map(|d| mongodb::bson::from_document::<Collation>(d))
        .transpose()
        .map_err(|e| AppError::Parse(format!("invalid collation: {e}")))?;
    // name = None ⇒ driver auto-generates a default name (field_dir_...).
    let options = IndexOptions::builder()
        .unique(unique.then_some(true))
        .name(name)
        .sparse(sparse.then_some(true))
        .expire_after(ttl_seconds.map(|s| Duration::from_secs(s.max(0) as u64)))
        .partial_filter_expression(partial_filter_doc)
        .collation(collation_opt)
        .build();
    let model = IndexModel::builder().keys(keys_doc).options(options).build();
    client
        .database(&db)
        .collection::<Document>(&coll)
        .create_index(model)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_index(
    session_id: String,
    db: String,
    coll: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client
        .database(&db)
        .collection::<Document>(&coll)
        .drop_index(name)
        .await?;
    Ok(())
}
