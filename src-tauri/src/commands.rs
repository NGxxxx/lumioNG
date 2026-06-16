use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
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
