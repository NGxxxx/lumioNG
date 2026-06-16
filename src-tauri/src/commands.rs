use crate::bson_json::{bson_to_canonical_string, doc_to_canonical_string};
use crate::error::AppError;
use crate::json_bson::{canonical_string_to_bson, canonical_string_to_doc};
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Document};
use mongodb::Client;
use tauri::State;

#[tauri::command]
pub async fn connect(uri: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let client = Client::with_uri_str(&uri)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    // Ping to confirm the connection is actually live (TLS/auth/SRV).
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    *state.client.lock().await = Some(client);
    Ok(())
}

use serde::Serialize;

#[derive(Serialize)]
pub struct DbInfo {
    pub name: String,
    pub collections: Vec<String>,
}

const SYSTEM_DBS: [&str; 3] = ["admin", "local", "config"];

#[tauri::command]
pub async fn list_namespaces(state: State<'_, AppState>) -> Result<Vec<DbInfo>, AppError> {
    let client = {
        let guard = state.client.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.clone()
    };

    let db_names = client.list_database_names().await?;
    let mut out = Vec::new();
    for name in db_names {
        if SYSTEM_DBS.contains(&name.as_str()) {
            continue;
        }
        let collections = client.database(&name).list_collection_names().await?;
        out.push(DbInfo { name, collections });
    }
    Ok(out)
}

#[tauri::command]
pub async fn query_page(
    db: String,
    coll: String,
    after_id: Option<String>,
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = {
        let guard = state.client.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.clone()
    };

    let collection = client.database(&db).collection::<Document>(&coll);

    // Skeleton assumes _id is an ObjectId (documented limitation).
    let filter = match after_id {
        Some(id) => {
            let oid = ObjectId::parse_str(&id)
                .map_err(|e| AppError::Query(format!("invalid after_id: {e}")))?;
            doc! { "_id": { "$gt": oid } }
        }
        None => doc! {},
    };

    let mut cursor = collection
        .find(filter)
        .sort(doc! { "_id": 1 })
        .limit(limit)
        .await?;

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
    let client = {
        let guard = state.client.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.clone()
    };

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
    let client = {
        let guard = state.client.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.clone()
    };

    let new_doc = canonical_string_to_doc(&doc_json)?;
    let id_bson = canonical_string_to_bson(&id_json)?;

    // _id is immutable: reject if the edited document carries a different _id.
    ensure_id_unchanged(&new_doc, &id_bson)?;

    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.replace_one(doc! { "_id": id_bson }, new_doc).await?;
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
    let client = {
        let guard = state.client.lock().await;
        guard.as_ref().ok_or(AppError::NotConnected)?.clone()
    };

    let id_bson = canonical_string_to_bson(&id_json)?;
    let collection = client.database(&db).collection::<Document>(&coll);
    let res = collection.delete_one(doc! { "_id": id_bson }).await?;
    if res.deleted_count == 0 {
        return Err(AppError::Query("không tìm thấy document để xóa".into()));
    }
    Ok(())
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
}
