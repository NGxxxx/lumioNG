use crate::error::AppError;
use crate::registry::{self, ConnectionInput, SavedConnection};
use crate::state::AppState;
use mongodb::bson::doc;
use mongodb::options::ClientOptions;
use mongodb::Client;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn connect(
    session_id: String,
    uri: String,
    read_only: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Parse the URI into options so we can override the driver defaults. The default
    // server_selection_timeout is 30s, which turns any transient Atlas hiccup (failover,
    // throttled shared tier, network blip) into a 30s freeze on every operation. Fail
    // faster so the UI surfaces the error promptly; the user can retry. Set app_name so
    // the connection is identifiable in Atlas metrics/profiler.
    let mut opts = ClientOptions::parse(&uri)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    opts.app_name.get_or_insert_with(|| "LumioNG".to_string());
    opts.server_selection_timeout = Some(Duration::from_secs(10));
    opts.connect_timeout.get_or_insert(Duration::from_secs(10));

    let client = Client::with_options(opts).map_err(|e| AppError::Connection(e.to_string()))?;

    // Ping to confirm the connection is actually live (TLS/auth/SRV).
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    state.insert_session(session_id, client, read_only).await;
    Ok(())
}

#[tauri::command]
pub async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.sessions.lock().await.remove(&session_id);
    Ok(())
}

#[derive(Serialize)]
pub struct DbInfo {
    pub name: String,
    pub collections: Vec<String>,
}

const SYSTEM_DBS: [&str; 3] = ["admin", "local", "config"];

#[tauri::command]
pub async fn list_namespaces(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DbInfo>, AppError> {
    let client = state.client(&session_id).await?;

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

fn registry_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("connections.json"))
}

#[tauri::command]
pub fn list_connections(app: AppHandle) -> Result<Vec<SavedConnection>, AppError> {
    registry::load(&registry_path(&app)?)
}

#[tauri::command]
pub fn save_connection(
    app: AppHandle,
    id: Option<u32>,
    input: ConnectionInput,
) -> Result<Vec<SavedConnection>, AppError> {
    let path = registry_path(&app)?;
    let list = registry::upsert(registry::load(&path)?, id, input);
    registry::save(&path, &list)?;
    Ok(list)
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    let path = registry_path(&app)?;
    let list = registry::remove(registry::load(&path)?, id);
    registry::save(&path, &list)?;
    Ok(list)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Stamp a saved connection's last-connected time. Called after a successful `connect`;
/// failures here must never block the connect flow (see `sessionManager.focusOrOpen`).
#[tauri::command]
pub fn touch_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    let path = registry_path(&app)?;
    let list = registry::touch(registry::load(&path)?, id, now_ms());
    registry::save(&path, &list)?;
    Ok(list)
}
