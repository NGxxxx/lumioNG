use crate::error::AppError;
use crate::known_hosts;
use crate::registry::{self, ConnectionInput, SavedConnection};
use crate::secrets::{self, Held, Locked, OsKeychain, SecretStore, VaultCtx};
use crate::vault::VaultSession;
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
    label: Option<String>,
    environment: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (client, tunnel) = open_client(&app, &uri, ssh).await?;
    state
        .insert_session(session_id, client, read_only, label.unwrap_or_default(), environment.unwrap_or_default(), tunnel)
        .await;
    Ok(())
}

/// Updates a live session's label / environment (e.g. the saved connection was re-labelled while open).
#[tauri::command]
pub async fn set_session_meta(
    session_id: String,
    label: String,
    environment: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.set_meta(&session_id, label, environment).await
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

pub(crate) fn registry_path(app: &AppHandle) -> Result<PathBuf, AppError> {
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

fn vault_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(registry_path(app)?.with_file_name("vault.json"))
}

fn vault_ctx<'a>(app: &AppHandle, session: &'a VaultSession) -> Result<VaultCtx<'a>, AppError> {
    Ok(VaultCtx { path: vault_path(app)?, session })
}

/// Loads the registry with secrets filled in from the credential store (or, without one, opened
/// from the vault), migrating any still kept in the file. Returns the full list plus what
/// `secrets::sync` and `secrets::seal_list` need to write it back.
fn load_full(
    path: &Path,
    store: &dyn SecretStore,
    ctx: &VaultCtx,
) -> Result<(Vec<SavedConnection>, Vec<SavedConnection>, Locked, Held), AppError> {
    let mut list = registry::load(path)?;
    // The vault is only ever consulted when there is no credential store.
    let use_vault = !store.available();
    let held = secrets::open_list(&mut list, ctx.session, use_vault);
    let locked = secrets::fill(&mut list, store);
    if secrets::needs_migration(&list, store) {
        let mut file = secrets::sync(&list, &list, &locked, store);
        secrets::seal_list(&mut file, &list, &held, ctx, !store.available())?;
        registry::save(path, &file)?;
        let flags: Vec<bool> = file.iter().map(|c| c.secrets_in_keychain).collect();
        for (c, f) in list.iter_mut().zip(flags) {
            c.secrets_in_keychain = f;
        }
    }
    Ok((list.clone(), list, locked, held))
}

/// Applies `change` to the full registry and saves it, keeping secrets in the credential store.
fn update_registry(
    app: &AppHandle,
    session: &VaultSession,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    update_registry_at(&registry_path(app)?, &OsKeychain, &vault_ctx(app, session)?, change)
}

fn update_registry_at(
    path: &Path,
    store: &dyn SecretStore,
    ctx: &VaultCtx,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    update_registry_inner(path, store, ctx, None, change)
}

/// `drop_held`: a connection whose held (sealed, unreadable) secrets must not be restored on this save.
fn update_registry_inner(
    path: &Path,
    store: &dyn SecretStore,
    ctx: &VaultCtx,
    drop_held: Option<u32>,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    let (before, list, locked, mut held) = load_full(path, store, ctx)?;
    if let Some(id) = drop_held {
        held.remove(&id);
    }
    let after = change(list);
    let mut file = secrets::sync(&before, &after, &locked, store);
    // Refuses (nothing written) rather than let a secret reach the file protected only by XOR.
    secrets::seal_list(&mut file, &before, &held, ctx, !store.available())?;
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
pub fn list_connections(app: AppHandle, vault: State<'_, VaultSession>) -> Result<Vec<SavedConnection>, AppError> {
    Ok(load_full(&registry_path(&app)?, &OsKeychain, &vault_ctx(&app, &vault)?)?.1)
}

#[tauri::command]
pub fn save_connection(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    id: Option<u32>,
    input: ConnectionInput,
    clear_secrets: Option<bool>,
) -> Result<Vec<SavedConnection>, AppError> {
    // "Save without password": the user chose no secret, so sealed values held for this connection go too.
    let drop_held = if clear_secrets == Some(true) { id } else { None };
    let (path, ctx) = (registry_path(&app)?, vault_ctx(&app, &vault)?);
    update_registry_inner(&path, &OsKeychain, &ctx, drop_held, |list| registry::upsert(list, id, input))
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, vault: State<'_, VaultSession>, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    update_registry(&app, &vault, |list| registry::remove(list, id))
}

/// Where saved passwords go: `"keychain"` (OS credential store) or `"file"` (obfuscated in
/// connections.json, when no credential store is available).
#[tauri::command]
pub fn secret_storage() -> &'static str {
    if OsKeychain.available() { "keychain" } else { "file" }
}

/// Whether the saved secrets can be read: `"not_needed"` (OS credential store), `"locked"` (ask for
/// the master password), `"unlocked"`, or `"uninitialized"` (file fallback, no master password yet).
#[tauri::command]
pub fn vault_status(app: AppHandle, vault: State<'_, VaultSession>) -> Result<&'static str, AppError> {
    Ok(secrets::vault_status(&OsKeychain, &vault_ctx(&app, &vault)?))
}

/// Unlocks the vault; a wrong password is an error of kind `Vault`.
#[tauri::command]
pub fn vault_unlock(app: AppHandle, vault: State<'_, VaultSession>, password: String) -> Result<(), AppError> {
    let password = zeroize::Zeroizing::new(password);
    secrets::vault_unlock(&vault_ctx(&app, &vault)?, &registry_path(&app)?, &password)
}

/// First-time setup: creates the vault with `password` and seals the secrets already in the file.
#[tauri::command]
pub fn vault_setup(app: AppHandle, vault: State<'_, VaultSession>, password: String) -> Result<(), AppError> {
    let password = zeroize::Zeroizing::new(password);
    secrets::vault_setup(&vault_ctx(&app, &vault)?, &registry_path(&app)?, &password)
}

/// "Forgot master password": deletes the vault and every sealed secret. Connections stay, with
/// empty passwords. Irreversible.
#[tauri::command]
pub fn vault_reset(app: AppHandle, vault: State<'_, VaultSession>) -> Result<(), AppError> {
    secrets::vault_reset(&vault_ctx(&app, &vault)?, &registry_path(&app)?)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Stamp a saved connection's last-connected time after a successful `connect`; failures here must never block the connect flow (see `sessionManager.focusOrOpen`).
#[tauri::command]
pub fn touch_connection(app: AppHandle, vault: State<'_, VaultSession>, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    update_registry(&app, &vault, |list| registry::touch(list, id, now_ms()))
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
        let session = VaultSession::default();
        let saved = update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        assert_eq!(saved[0].password_enc, "enc-secret"); // the frontend still gets it back
        assert!(saved[0].secrets_in_keychain);
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("enc-secret"));

        let listed = load_full(&path, &store, &ctx(&path, &session)).unwrap().1;
        assert_eq!(listed[0].password_enc, "enc-secret");

        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::touch(l, 1, 7)).unwrap();
        assert_eq!(*store.writes.borrow(), 1); // a touch never rewrites the credential

        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::remove(l, 1)).unwrap();
        assert!(store.items.borrow().is_empty());
    }

    #[test]
    fn an_old_file_is_migrated_on_first_load() {
        let path = temp("migrate");
        registry::save(&path, &registry::upsert(vec![], None, input("legacy-enc"))).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("legacy-enc"));
        let store = MemoryStore::default();
        let session = VaultSession::default();
        let listed = load_full(&path, &store, &ctx(&path, &session)).unwrap().1;
        assert_eq!(listed[0].password_enc, "legacy-enc");
        assert!(listed[0].secrets_in_keychain);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("legacy-enc"));
        assert!(store.items.borrow()[&1].contains("legacy-enc"));
    }

    #[test]
    fn without_a_store_connections_without_secrets_save_as_before() {
        let path = temp("nostore");
        let store = MemoryStore { broken: true, ..Default::default() };
        let session = VaultSession::default();
        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input(""))).unwrap();
        assert_eq!(load_full(&path, &store, &ctx(&path, &session)).unwrap().1.len(), 1);
        // A secret needs the vault first (see the refusal tests below).
        assert!(update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input("enc-secret"))).is_err());
    }

    // ── file fallback sealed by the master-password vault ──

    const MASTER: &str = "master-pw-1";

    fn ctx<'a>(path: &Path, session: &'a VaultSession) -> VaultCtx<'a> {
        VaultCtx { path: path.with_file_name("vault.json"), session }
    }
    fn no_store() -> MemoryStore {
        MemoryStore { broken: true, ..Default::default() }
    }
    fn vault_code(r: Result<Vec<SavedConnection>, AppError>) -> String {
        match r {
            Err(AppError::Vault(code)) => code,
            other => panic!("expected a vault refusal, got {other:?}"),
        }
    }
    /// A pre-vault file: one connection whose secret sits there as plain obfuscated text.
    fn legacy_file(name: &str, pw: &str) -> std::path::PathBuf {
        let path = temp(name);
        registry::save(&path, &registry::upsert(vec![], None, input(pw))).unwrap();
        path
    }

    #[test]
    fn legacy_unsealed_values_are_sealed_on_unlock() {
        let path = legacy_file("legacy_seal", "legacy-enc");
        let session = VaultSession::default();
        let store = no_store();
        assert!(std::fs::read_to_string(&path).unwrap().contains("legacy-enc"));

        // Before any vault exists the old value may stay as it is (touching a connection works)…
        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::touch(l, 1, 2)).unwrap();
        // …and setting up the vault seals what the file already holds.
        secrets::vault_setup(&ctx(&path, &session), &path, MASTER).unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("legacy-enc") && on_disk.contains("vault:v1:"));
        assert_eq!(load_full(&path, &store, &ctx(&path, &session)).unwrap().1[0].password_enc, "legacy-enc");

        // After a restart the file is sealed, so the list shows no secret until unlock.
        let restarted = VaultSession::default();
        assert_eq!(secrets::vault_status(&store, &ctx(&path, &restarted)), "locked");
        assert_eq!(load_full(&path, &store, &ctx(&path, &restarted)).unwrap().1[0].password_enc, "");
        // An unrelated save while locked keeps the seal.
        update_registry_at(&path, &store, &ctx(&path, &restarted), |l| registry::touch(l, 1, 9)).unwrap();
        assert!(registry::load(&path).unwrap()[0].password_enc.starts_with("vault:v1:"));
        // Wrong password changes nothing; the right one unlocks.
        assert!(secrets::vault_unlock(&ctx(&path, &restarted), &path, "nope-nope").is_err());
        assert_eq!(secrets::vault_status(&store, &ctx(&path, &restarted)), "locked");
        secrets::vault_unlock(&ctx(&path, &restarted), &path, MASTER).unwrap();
        assert_eq!(load_full(&path, &store, &ctx(&path, &restarted)).unwrap().1[0].password_enc, "legacy-enc");
        assert_eq!(secrets::vault_status(&store, &ctx(&path, &restarted)), "unlocked");
    }

    #[test]
    fn a_new_secret_is_refused_while_the_vault_is_uninitialized() {
        let path = temp("refuse_uninit");
        let session = VaultSession::default();
        let store = no_store();
        let r = update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input("typed-pw")));
        assert_eq!(vault_code(r), "vault_uninitialized");
        assert!(!path.exists(), "nothing may be written");

        // Without the password the connection saves fine.
        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input(""))).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("typed-pw"));

        // Changing a legacy plain value is refused too; leaving it alone is not.
        let path = legacy_file("refuse_uninit_edit", "old");
        let edit = |pw: &'static str| move |mut l: Vec<SavedConnection>| {
            l[0].password_enc = pw.into();
            l
        };
        assert_eq!(vault_code(update_registry_at(&path, &store, &ctx(&path, &session), edit("changed"))), "vault_uninitialized");
        update_registry_at(&path, &store, &ctx(&path, &session), edit("old")).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("changed"));
    }

    #[test]
    fn a_new_secret_is_refused_while_the_vault_is_locked() {
        let path = legacy_file("refuse_locked", "legacy-enc");
        let store = no_store();
        let first = VaultSession::default();
        secrets::vault_setup(&ctx(&path, &first), &path, MASTER).unwrap();
        let locked = VaultSession::default();
        let before = std::fs::read_to_string(&path).unwrap();

        // A typed password for a connection whose secret is sealed: refused, file untouched.
        let r = update_registry_at(&path, &store, &ctx(&path, &locked), |mut l| {
            l[0].password_enc = "typed-pw".into();
            l
        });
        assert_eq!(vault_code(r), "vault_locked");
        // A brand-new connection with a secret: refused as well.
        let r = update_registry_at(&path, &store, &ctx(&path, &locked), |l| registry::upsert(l, None, input("typed-pw")));
        assert_eq!(vault_code(r), "vault_locked");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("typed-pw"));

        // Saving without a password works and keeps the sealed secrets of other connections.
        update_registry_at(&path, &store, &ctx(&path, &locked), |l| registry::upsert(l, None, input(""))).unwrap();
        let list = registry::load(&path).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].password_enc.starts_with("vault:v1:"));

        // Once unlocked the same save goes through, sealed.
        secrets::vault_unlock(&ctx(&path, &locked), &path, MASTER).unwrap();
        update_registry_at(&path, &store, &ctx(&path, &locked), |l| registry::upsert(l, Some(2), input("typed-pw"))).unwrap();
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("typed-pw") && !on_disk.contains("legacy-enc"));
    }

    #[test]
    fn saving_without_password_discards_held_sealed_secrets() {
        let path = legacy_file("clear_held", "legacy-enc");
        let store = no_store();
        let first = VaultSession::default();
        secrets::vault_setup(&ctx(&path, &first), &path, MASTER).unwrap();
        let locked = VaultSession::default();
        let blank = |l: Vec<SavedConnection>| registry::upsert(l, Some(1), input(""));

        // A normal blank save while locked keeps the seal (blank reads as "unreadable")…
        update_registry_at(&path, &store, &ctx(&path, &locked), blank).unwrap();
        assert!(registry::load(&path).unwrap()[0].password_enc.starts_with("vault:v1:"));
        // …but an explicit "save without password" really removes it.
        update_registry_inner(&path, &store, &ctx(&path, &locked), Some(1), blank).unwrap();
        assert_eq!(registry::load(&path).unwrap()[0].password_enc, "");
    }

    #[test]
    fn unlock_stays_locked_when_sealing_the_file_fails() {
        let path = legacy_file("unlock_seal_fail", "legacy-enc");
        let first = VaultSession::default();
        secrets::vault_setup(&ctx(&path, &first), &path, MASTER).unwrap();
        std::fs::write(&path, "not json").unwrap(); // sealing cannot read the registry
        let restarted = VaultSession::default();
        assert!(secrets::vault_unlock(&ctx(&path, &restarted), &path, MASTER).is_err());
        assert!(!restarted.is_unlocked());
        assert_eq!(secrets::vault_status(&no_store(), &ctx(&path, &restarted)), "locked");
    }

    #[test]
    fn failed_setup_leaves_no_vault_behind_and_short_passwords_are_refused() {
        let path = legacy_file("setup_fail", "legacy-enc");
        let session = VaultSession::default();
        let vault_json = path.with_file_name("vault.json");
        assert!(secrets::vault_setup(&ctx(&path, &session), &path, "short").is_err());
        assert!(!vault_json.exists() && !session.is_unlocked());
        assert!(secrets::vault_setup(&ctx(&path, &session), &path, "12345678").is_ok());
        let _ = std::fs::remove_file(&vault_json);

        let path = temp("setup_fail_2");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not json").unwrap();
        let session = VaultSession::default();
        assert!(secrets::vault_setup(&ctx(&path, &session), &path, MASTER).is_err());
        assert!(!path.with_file_name("vault.json").exists() && !session.is_unlocked());
    }

    #[test]
    fn keychain_mode_never_touches_vault() {
        let path = temp("keychain_vault");
        let session = VaultSession::default();
        let store = MemoryStore::default();
        assert_eq!(secrets::vault_status(&store, &ctx(&path, &session)), "not_needed");
        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        load_full(&path, &store, &ctx(&path, &session)).unwrap();
        assert!(!path.with_file_name("vault.json").exists());
        assert!(!std::fs::read_to_string(&path).unwrap().contains("vault:v1:"));
        // Even a key left in memory is not used to seal anything while a credential store exists.
        let (v, _) = crate::vault::Vault::create("x").unwrap();
        session.set(v);
        update_registry_at(&path, &store, &ctx(&path, &session), |l| registry::touch(l, 1, 3)).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("vault:v1:"));
        assert!(!path.with_file_name("vault.json").exists());
    }

    #[test]
    fn every_enc_field_is_sealed_and_reset_clears_them() {
        let path = legacy_file("all_fields", "p1");
        let mut list = registry::load(&path).unwrap();
        list[0].tls_certificate_key_file_password_enc = "p2".into();
        list[0].ssh_password_enc = "p3".into();
        list[0].ssh_passphrase_enc = "p4".into();
        registry::save(&path, &list).unwrap();
        let session = VaultSession::default();
        secrets::vault_setup(&ctx(&path, &session), &path, MASTER).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        for plain in ["p1", "p2", "p3", "p4"] {
            assert!(!raw.contains(&format!("\"{plain}\"")), "{plain} still readable");
        }
        // "Forgot master password": the connection stays, its secrets are gone, the vault is reset.
        let restarted = VaultSession::default();
        secrets::vault_reset(&ctx(&path, &restarted), &path).unwrap();
        let list = registry::load(&path).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(secrets::Secrets::of(&list[0]), secrets::Secrets::default());
        assert!(!path.with_file_name("vault.json").exists());
        assert_eq!(secrets::vault_status(&no_store(), &ctx(&path, &restarted)), "uninitialized");
    }
}
