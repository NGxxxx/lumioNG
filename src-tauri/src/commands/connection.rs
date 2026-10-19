use crate::error::AppError;
use crate::known_hosts;
use crate::registry::{self, ConnectionInput, SavedConnection};
use crate::secrets::{self, Locked, OsKeychain, SecretStore};
use crate::ssh_tunnel::{self, SshTunnelConfig, SshTunnelHandle};
use crate::state::AppState;
use futures::future::try_join_all;
use mongodb::bson::doc;
use mongodb::options::{ClientOptions, ServerAddress};
use mongodb::Client;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Opens an SSH tunnel (if enabled) and rewrites `opts.hosts` to the local forwarded port; shared by `connect` and `test_connection`.
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
    include_system_dbs: bool,
    state: State<'_, AppState>,
) -> Result<Vec<DbInfo>, AppError> {
    let client = state.client(&session_id).await?;

    let db_names = client.list_database_names().await?;
    // Fetch each database's collection list concurrently instead of one round trip at a time.
    let fetches = db_names
        .into_iter()
        .filter(|name| include_system_dbs || !SYSTEM_DBS.contains(&name.as_str()))
        .map(|name| {
            let client = client.clone();
            async move {
                let collections = client.database(&name).list_collection_names().await?;
                Ok::<DbInfo, AppError>(DbInfo { name, collections })
            }
        });
    try_join_all(fetches).await
}

/// Names of a database's real collections (no views, no `system.*`): a lookup by `_id` on a view
/// would run its whole pipeline, so the reference search never touches one.
fn plain_collections_filter() -> mongodb::bson::Document {
    mongodb::bson::doc! { "type": "collection", "name": { "$not": { "$regex": "^system\\." } } }
}

#[tauri::command]
pub async fn list_plain_collections(
    session_id: String,
    db: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    Ok(client
        .database(&db)
        .list_collection_names()
        .filter(plain_collections_filter())
        .await?)
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

/// Loads the registry with secrets filled in from the credential store, migrating any still kept
/// in the file. Returns the full list plus what `secrets::sync` needs to write it back.
fn load_full(path: &Path, store: &dyn SecretStore) -> Result<(Vec<SavedConnection>, Vec<SavedConnection>, Locked), AppError> {
    let mut list = registry::load(path)?;
    let locked = secrets::fill(&mut list, store);
    if secrets::needs_migration(&list, store) {
        let file = secrets::sync(&list, &list, &locked, store);
        registry::save(path, &file)?;
        let flags: Vec<bool> = file.iter().map(|c| c.secrets_in_keychain).collect();
        for (c, f) in list.iter_mut().zip(flags) {
            c.secrets_in_keychain = f;
        }
    }
    Ok((list.clone(), list, locked))
}

/// Applies `change` to the full registry and saves it, keeping secrets in the credential store.
fn update_registry(
    app: &AppHandle,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    update_registry_at(&registry_path(app)?, &OsKeychain, change)
}

fn update_registry_at(
    path: &Path,
    store: &dyn SecretStore,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    let (before, list, locked) = load_full(path, store)?;
    let after = change(list);
    let file = secrets::sync(&before, &after, &locked, store);
    registry::save(path, &file)?;
    // The frontend gets the secrets back, with the flags as stored.
    Ok(after
        .into_iter()
        .zip(file)
        .map(|(mut a, f)| {
            a.secrets_in_keychain = f.secrets_in_keychain;
            a
        })
        .collect())
}

#[tauri::command]
pub fn list_connections(app: AppHandle) -> Result<Vec<SavedConnection>, AppError> {
    Ok(load_full(&registry_path(&app)?, &OsKeychain)?.1)
}

#[tauri::command]
pub fn save_connection(
    app: AppHandle,
    id: Option<u32>,
    input: ConnectionInput,
) -> Result<Vec<SavedConnection>, AppError> {
    update_registry(&app, |list| registry::upsert(list, id, input))
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    update_registry(&app, |list| registry::remove(list, id))
}

/// Where saved passwords go: `"keychain"` (OS credential store) or `"file"` (obfuscated in
/// connections.json, when no credential store is available).
#[tauri::command]
pub fn secret_storage() -> &'static str {
    if OsKeychain.available() { "keychain" } else { "file" }
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
    update_registry(&app, |list| registry::touch(list, id, now_ms()))
}

#[cfg(test)]
mod plain_collections_tests {
    use super::*;

    #[test]
    fn filter_keeps_only_real_non_system_collections() {
        let f = plain_collections_filter();
        assert_eq!(f.get_str("type").unwrap(), "collection");
        let re = f.get_document("name").unwrap().get_document("$not").unwrap().get_str("$regex").unwrap();
        assert_eq!(re, "^system\\.");
    }
}

#[cfg(test)]
mod registry_secret_tests {
    use super::*;
    use crate::secrets::memory::MemoryStore;

    fn input(pw: &str) -> ConnectionInput {
        let mut c = serde_json::from_value::<ConnectionInput>(serde_json::json!({
            "label": "Prod", "scheme": "mongodb", "host": "db", "port": 27017, "authMethod": "password",
            "user": "u", "passwordEnc": pw, "authSource": "", "replicaSet": "", "tls": false,
            "extraOptions": "", "readOnly": false, "tlsCertificateKeyFile": "",
            "tlsCertificateKeyFilePasswordEnc": "", "sshEnabled": false, "sshHost": "", "sshPort": 22,
            "sshUser": "", "sshAuthMethod": "password", "sshPasswordEnc": "", "sshPrivateKeyPath": "",
            "sshPassphraseEnc": ""
        }))
        .unwrap();
        c.password_enc = pw.into();
        c
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lumio_test_secrets_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("connections.json")
    }

    #[test]
    fn save_list_and_delete_keep_passwords_out_of_the_file() {
        let path = temp("roundtrip");
        let store = MemoryStore::default();
        let saved = update_registry_at(&path, &store, |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        assert_eq!(saved[0].password_enc, "enc-secret"); // the frontend still gets it back
        assert!(saved[0].secrets_in_keychain);
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("enc-secret"));

        let listed = load_full(&path, &store).unwrap().1;
        assert_eq!(listed[0].password_enc, "enc-secret");

        update_registry_at(&path, &store, |l| registry::touch(l, 1, 7)).unwrap();
        assert_eq!(*store.writes.borrow(), 1); // a touch never rewrites the credential

        update_registry_at(&path, &store, |l| registry::remove(l, 1)).unwrap();
        assert!(store.items.borrow().is_empty());
    }

    #[test]
    fn an_old_file_is_migrated_on_first_load() {
        let path = temp("migrate");
        registry::save(&path, &registry::upsert(vec![], None, input("legacy-enc"))).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("legacy-enc"));
        let store = MemoryStore::default();
        let listed = load_full(&path, &store).unwrap().1;
        assert_eq!(listed[0].password_enc, "legacy-enc");
        assert!(listed[0].secrets_in_keychain);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("legacy-enc"));
        assert!(store.items.borrow()[&1].contains("legacy-enc"));
    }

    #[test]
    fn without_a_store_everything_works_as_before() {
        let path = temp("nostore");
        let store = MemoryStore { broken: true, ..Default::default() };
        update_registry_at(&path, &store, |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("enc-secret"));
        assert_eq!(load_full(&path, &store).unwrap().1[0].password_enc, "enc-secret");
    }
}

