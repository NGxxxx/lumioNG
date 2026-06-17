use crate::error::AppError;
use crate::state::AppState;
use mongodb::bson::doc;
use mongodb::Client;
use serde::Serialize;
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

#[derive(Serialize)]
pub struct DbInfo {
    pub name: String,
    pub collections: Vec<String>,
}

const SYSTEM_DBS: [&str; 3] = ["admin", "local", "config"];

#[tauri::command]
pub async fn list_namespaces(state: State<'_, AppState>) -> Result<Vec<DbInfo>, AppError> {
    let client = state.client().await?;

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
