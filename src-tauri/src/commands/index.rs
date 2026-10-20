use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_doc, canonical_string_to_doc_array};
use crate::state::AppState;
use mongodb::bson::{doc, Document};
use mongodb::options::{Collation, IndexOptions};
use mongodb::IndexModel;
use std::time::Duration;
use futures::stream::TryStreamExt;
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
    let client = state.writable_client(&session_id).await?;
    let keys_doc = canonical_string_to_doc(&keys)?;
    let partial_filter_doc = partial_filter
        .as_deref()
        .map(canonical_string_to_doc)
        .transpose()?;
    let collation_opt = collation
        .as_deref()
        .map(canonical_string_to_doc)
        .transpose()?
        .map(mongodb::bson::from_document::<Collation>)
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
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "create_index", &format!("{db}.{coll}"), None, |_| None, async {
            client.database(&db).collection::<Document>(&coll).create_index(model).await?;
            Ok::<_, AppError>(())
        })
        .await
}

/// Recreates indexes from their raw `listIndexes` documents (as produced by `list_indexes`) —
/// used to restore a collection's indexes from an exported metadata sidecar. Passed through to
/// `createIndexes` largely as-is (server ignores/regenerates fields like `v`); the default `_id_`
/// index is skipped since every collection already has one.
#[tauri::command]
pub async fn create_indexes_raw(
    session_id: String,
    db: String,
    coll: String,
    indexes_json: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    let specs: Vec<Document> = canonical_string_to_doc_array(
        &indexes_json,
        "expected a JSON array of index documents",
        "each index must be a JSON document",
    )?
    .into_iter()
    .filter(|d| d.get_str("name").ok() != Some("_id_"))
    .collect();
    if specs.is_empty() {
        return Ok(());
    }
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "create_indexes", &format!("{db}.{coll}"), None, |_| None, async {
            client.database(&db).run_command(doc! { "createIndexes": &coll, "indexes": specs }).await?;
            Ok::<_, AppError>(())
        })
        .await
}

#[tauri::command]
pub async fn drop_index(
    session_id: String,
    db: String,
    coll: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "drop_index", &format!("{db}.{coll}"), None, |_| None, async {
            client.database(&db).collection::<Document>(&coll).drop_index(name).await?;
            Ok::<_, AppError>(())
        })
        .await
}

/// Per-index usage counters (`$indexStats`): one entry per index per host/shard.
#[tauri::command]
pub async fn index_stats(
    session_id: String,
    db: String,
    coll: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let mut cursor = client
        .database(&db)
        .collection::<Document>(&coll)
        .aggregate(vec![doc! { "$indexStats": {} }])
        .await?;
    let mut out = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        out.push(doc_to_canonical_string(d)?);
    }
    Ok(out)
}

fn hide_index_command(coll: &str, name: &str, hidden: bool) -> Document {
    doc! { "collMod": coll, "index": { "name": name, "hidden": hidden } }
}

/// Hide / unhide an index (MongoDB 4.4+): the planner ignores a hidden index but keeps maintaining it.
#[tauri::command]
pub async fn set_index_hidden(
    session_id: String,
    db: String,
    coll: String,
    name: String,
    hidden: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    state
        .audited(&session_id, crate::audit::SOURCE_UI, "set_index_hidden", &format!("{db}.{coll}"), None, |_| None, async {
            client.database(&db).run_command(hide_index_command(&coll, &name, hidden)).await?;
            Ok::<_, AppError>(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hide_index_command_shape() {
        assert_eq!(
            hide_index_command("orders", "a_1", true),
            doc! { "collMod": "orders", "index": { "name": "a_1", "hidden": true } }
        );
    }
}
