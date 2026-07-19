use crate::error::AppError;
use crate::known_hosts;
use crate::registry::{self, ConnectionInput, SavedConnection};
use crate::ssh_tunnel::{self, SshTunnelConfig, SshTunnelHandle};
use crate::state::AppState;
use futures::future::try_join_all;
use mongodb::bson::doc;
use mongodb::options::{ClientOptions, ServerAddress};
use mongodb::Client;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Opens an SSH tunnel (if `ssh` is enabled) and rewrites `opts.hosts` to point at the local
/// forwarded port before the Mongo client ever sees the real remote host. Shared by `connect`
/// and `test_connection` so both go through the identical tunnel-then-ping sequence.
async fn open_client(
    app: &AppHandle,
    uri: &str,
    ssh: Option<SshTunnelConfig>,
) -> Result<(Client, Option<SshTunnelHandle>), AppError> {
    // Override the driver's 30s server_selection_timeout default so a transient Atlas hiccup doesn't freeze every operation for 30s; also set app_name for Atlas metrics/profiler.
    let mut opts = ClientOptions::parse(uri)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    opts.app_name.get_or_insert_with(|| "LumioNG".to_string());
    opts.server_selection_timeout = Some(Duration::from_secs(10));
    opts.connect_timeout.get_or_insert(Duration::from_secs(10));

    let tunnel = match ssh {
        Some(cfg) if cfg.enabled => {
            let ServerAddress::Tcp { host: remote_host, port: remote_port } = opts
                .hosts
                .first()
                .cloned()
                .ok_or_else(|| AppError::Connection("no host in connection URI".into()))?
            else {
                return Err(AppError::Connection("SSH tunnel requires a direct host:port URI".into()));
            };
            let tunnel = ssh_tunnel::open(&cfg, &remote_host, remote_port.unwrap_or(27017), &known_hosts_path(app)?).await?;
            opts.hosts = vec![ServerAddress::Tcp { host: "127.0.0.1".into(), port: Some(tunnel.local_port) }];
            Some(tunnel)
        }
        _ => None,
    };

    let client = Client::with_options(opts).map_err(|e| AppError::Connection(e.to_string()))?;

    // Ping to confirm the connection is actually live (TLS/auth/SRV) — through the tunnel, if any.
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    Ok((client, tunnel))
}

#[tauri::command]
pub async fn connect(
    app: AppHandle,
    session_id: String,
    uri: String,
    read_only: bool,
    ssh: Option<SshTunnelConfig>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (client, tunnel) = open_client(&app, &uri, ssh).await?;
    state.insert_session(session_id, client, read_only, tunnel).await;
    Ok(())
}

/// Validates a connection (SSH tunnel + Mongo auth/TLS) without opening a session — the client
/// and tunnel are simply dropped at the end of this function.
#[tauri::command]
pub async fn test_connection(app: AppHandle, uri: String, ssh: Option<SshTunnelConfig>) -> Result<(), AppError> {
    open_client(&app, &uri, ssh).await?;
    Ok(())
}

#[tauri::command]
pub async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.remove_session(&session_id).await;
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
    // Fetch each database's collection list concurrently instead of one round trip at a time.
    let fetches = db_names
        .into_iter()
        .filter(|name| !SYSTEM_DBS.contains(&name.as_str()))
        .map(|name| {
            let client = client.clone();
            async move {
                let collections = client.database(&name).list_collection_names().await?;
                Ok::<DbInfo, AppError>(DbInfo { name, collections })
            }
        });
    try_join_all(fetches).await
}

fn registry_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("connections.json"))
}

fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("known_hosts.json"))
}

/// Drops the trusted SSH host key for `host:port`, if any, so the next connect trusts whatever key
/// the server presents (first use again) — the escape hatch for a legitimate host key rotation.
#[tauri::command]
pub fn forget_ssh_host_key(app: AppHandle, host: String, port: u16) -> Result<(), AppError> {
    let path = known_hosts_path(&app)?;
    let list = known_hosts::forget(known_hosts::load(&path)?, &host, port);
    known_hosts::save(&path, &list)
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

/// Stamp a saved connection's last-connected time after a successful `connect`; failures here must never block the connect flow (see `sessionManager.focusOrOpen`).
#[tauri::command]
pub fn touch_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    let path = registry_path(&app)?;
    let list = registry::touch(registry::load(&path)?, id, now_ms());
    registry::save(&path, &list)?;
    Ok(list)
}
