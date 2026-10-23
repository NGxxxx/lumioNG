use crate::commands::csfle;
use crate::error::AppError;
use crate::http_client;
use crate::http_proxy_tunnel;
use crate::known_hosts;
use crate::oidc_human;
use crate::proxy::ProxyConfig;
use crate::registry::{self, ConnectionInput, SavedConnection};
use crate::secrets::{self, Held, Locked, OsKeychain, SecretStore, VaultCtx};
use crate::vault::VaultSession;
use crate::ssh_tunnel::{self, SshTunnelConfig};
use crate::state::{AppState, Session};
use crate::util::{blocking, config_dir, lock_recover, now_ms};
use futures::future::try_join_all;
use mongodb::bson::doc;
use mongodb::options::{AuthMechanism, ClientOptions, ServerAddress};
use mongodb::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

/// Refresh tokens of OIDC connections whose token could not be persisted (vault locked or never set
/// up), so a reconnect within this run still skips the browser. Never written anywhere.
static OIDC_MEMORY: LazyLock<Mutex<HashMap<u32, String>>> = LazyLock::new(Default::default);

/// The OIDC refresh token of one saved connection: memory for this run, the OS keychain (or the
/// vault when there is none) across runs.
struct AppTokens {
    app: AppHandle,
    id: u32,
}

impl AppTokens {
    fn with_ctx<T>(&self, f: impl FnOnce(&VaultCtx) -> T) -> Option<T> {
        let session = self.app.state::<VaultSession>();
        let ctx = vault_ctx(&self.app, &session).ok()?;
        Some(f(&ctx))
    }
}

impl oidc_human::TokenPersist for AppTokens {
    fn load(&self) -> Option<String> {
        if let Some(t) = OIDC_MEMORY.lock().ok().and_then(|m| m.get(&self.id).cloned()) {
            return Some(t);
        }
        self.with_ctx(|ctx| secrets::oidc_token_load(&OsKeychain, ctx, self.id)).flatten()
    }
    fn save(&self, token: &str) {
        if let Ok(mut m) = OIDC_MEMORY.lock() {
            m.insert(self.id, token.to_string());
        }
        if let Some(secrets::TokenOutcome::NotPersisted(reason)) = self.with_ctx(|ctx| secrets::oidc_token_save(&OsKeychain, ctx, self.id, token)) {
            tracing::warn!(connection = self.id, reason, "OIDC refresh token not saved; it is kept in memory for this session only");
        }
    }
    fn forget(&self) {
        if let Ok(mut m) = OIDC_MEMORY.lock() {
            m.remove(&self.id);
        }
        self.with_ctx(|ctx| secrets::oidc_token_forget(&OsKeychain, ctx, self.id));
    }
}

/// Whether the URI asked for MONGODB-OIDC with no `ENVIRONMENT`, i.e. a person signing in (workforce).
/// With an `ENVIRONMENT` the driver fetches the token itself and refuses a user-supplied callback.
pub(crate) fn needs_human_oidc(opts: &ClientOptions) -> bool {
    opts.credential.as_ref().is_some_and(|c| {
        c.mechanism == Some(AuthMechanism::MongoDbOidc) && !c.mechanism_properties.as_ref().is_some_and(|p| p.contains_key("ENVIRONMENT"))
    })
}

/// Installs the browser sign-in callback; its HTTP traffic (discovery, token endpoint) uses the connection's proxy.
fn attach_human_oidc(app: &AppHandle, opts: &mut ClientOptions, proxy: Option<&ProxyConfig>, connection_id: Option<u32>) -> Result<(), AppError> {
    if !needs_human_oidc(opts) {
        return Ok(());
    }
    let http = http_client::build_no_redirect(proxy, Duration::from_secs(30))?;
    let opener = app.clone();
    let open: oidc_human::OpenBrowser = Arc::new(move |url: &str| opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string()));
    let tokens = connection_id.map(|id| Arc::new(AppTokens { app: app.clone(), id }) as Arc<dyn oidc_human::TokenPersist>);
    let Some(cred) = opts.credential.as_mut() else { return Ok(()) };
    let hint = cred.username.clone();
    cred.oidc_callback = oidc_human::HumanFlow::new(http, open, tokens, hint).into_callback();
    Ok(())
}

/// Port the driver assumes when a URI host has none.
pub(crate) const DEFAULT_PORT: u16 = 27017;
/// Why an HTTP proxy cannot carry a URI (the forwarder pins exactly one target host).
pub(crate) const SINGLE_HOST_REQUIRED: &str = "An HTTP proxy requires a single direct host (no mongodb+srv, no replica set seed list)";
/// Server selection / connect timeout instead of the driver's 30 s, so a transient Atlas hiccup doesn't freeze every operation for 30 s.
pub(crate) const DRIVER_TIMEOUT: Duration = Duration::from_secs(10);

/// `(host, port)` of a TCP address, the port defaulting to 27017 (`None` for a Unix socket).
pub(crate) fn tcp_host_port(addr: &ServerAddress) -> Option<(String, u16)> {
    match addr {
        ServerAddress::Tcp { host, port } => Some((host.clone(), port.unwrap_or(DEFAULT_PORT))),
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

/// The first host of the URI, as the target of a tunnel. `what` names the feature in the error.
pub(crate) fn first_host(opts: &ClientOptions, what: &str) -> Result<(String, u16), AppError> {
    let addr = opts.hosts.first().ok_or_else(|| AppError::Connection("no host in connection URI".into()))?;
    tcp_host_port(addr).ok_or_else(|| AppError::Connection(format!("{what} requires a direct host:port URI")))
}

/// The one host an HTTP proxy forwarder can carry: refuses `mongodb+srv` and replica set seed lists.
pub(crate) fn single_direct_host(opts: &ClientOptions, is_srv: bool) -> Result<(String, u16), AppError> {
    if opts.hosts.len() != 1 || is_srv {
        return Err(AppError::Connection(SINGLE_HOST_REQUIRED.into()));
    }
    first_host(opts, "An HTTP proxy")
}

/// Points the driver at a local forwarder (SSH tunnel or HTTP proxy) instead of the URI's hosts.
pub(crate) fn route_via_local(opts: &mut ClientOptions, local_port: u16) {
    opts.hosts = vec![ServerAddress::Tcp { host: "127.0.0.1".into(), port: Some(local_port) }];
}

/// The app's driver defaults: `app_name` (Atlas metrics / profiler) unless the URI set one, and 10 s timeouts.
pub(crate) fn apply_driver_defaults(opts: &mut ClientOptions) {
    opts.app_name.get_or_insert_with(|| "LumioNG".to_string());
    opts.server_selection_timeout = Some(DRIVER_TIMEOUT);
    opts.connect_timeout.get_or_insert(DRIVER_TIMEOUT);
}

/// Opens an SSH tunnel or an HTTP CONNECT forwarder (if requested) and rewrites `opts.hosts` to the local
/// forwarded port; shared by `connect` and `test_connection`. A SOCKS5 proxy needs no work here: its
/// `proxyHost`/`proxyPort`/... options travel in the URI and the driver applies them to every host.
/// Returns a complete session (read-write, no label) holding everything that must live as long as the client.
async fn open_client(
    app: &AppHandle,
    uri: &str,
    ssh: Option<SshTunnelConfig>,
    proxy: Option<ProxyConfig>,
    connection_id: Option<u32>,
) -> Result<Session, AppError> {
    let oidc_proxy = proxy.clone();
    let http_proxy = proxy.filter(|p| p.is_http());
    if http_proxy.is_some() && ssh.as_ref().is_some_and(|s| s.enabled) {
        return Err(AppError::Connection("An SSH tunnel and a proxy cannot be used together".into()));
    }
    let mut opts = ClientOptions::parse(uri)
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;
    apply_driver_defaults(&mut opts);
    attach_human_oidc(app, &mut opts, oidc_proxy.as_ref(), connection_id)?;

    let tunnel = match ssh {
        Some(cfg) if cfg.enabled => {
            let (remote_host, remote_port) = first_host(&opts, "SSH tunnel")?;
            let tunnel = ssh_tunnel::open(&cfg, &remote_host, remote_port, &known_hosts_path(app)?).await?;
            route_via_local(&mut opts, tunnel.local_port);
            Some(tunnel)
        }
        _ => None,
    };

    let proxy_tunnel = match http_proxy {
        Some(cfg) => {
            let is_srv = uri.trim_start().to_lowercase().starts_with("mongodb+srv");
            let (remote_host, remote_port) = single_direct_host(&opts, is_srv)?;
            let t = http_proxy_tunnel::open(&cfg, &remote_host, remote_port).await?;
            route_via_local(&mut opts, t.local_port);
            Some(t)
        }
        None => None,
    };

    // Client-side field level encryption: reads are decrypted automatically (no auto-encryption on write).
    let (client, csfle_parts): (Client, Option<(Arc<csfle::CsfleHandle>, Client)>) = match csfle::prepare(app, &app.state::<VaultSession>(), connection_id)? {
        #[cfg(feature = "csfle")]
        Some(prepared) => {
            // The non-decrypting twin is built from the very same options (tunnel, proxy, OIDC included).
            let raw = Client::with_options(opts.clone()).map_err(|e| AppError::Connection(e.to_string()))?;
            let (client, handle) = prepared.build_client(opts).await?;
            (client, Some((Arc::new(handle), raw)))
        }
        #[cfg(not(feature = "csfle"))]
        Some(_) => return Err(AppError::Connection(csfle::NOT_AVAILABLE.into())),
        None => (Client::with_options(opts).map_err(|e| AppError::Connection(e.to_string()))?, None),
    };

    // Ping to confirm the connection is actually live (TLS/auth/SRV) — through the tunnel, if any.
    client
        .database("admin")
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|e| AppError::Connection(e.to_string()))?;

    let (csfle, raw_client) = csfle_parts.unzip();
    Ok(Session { tunnel, proxy_tunnel, csfle, raw_client, ..Session::new(client, false, String::new(), String::new()) })
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
    proxy: Option<ProxyConfig>,
    connection_id: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let opened = open_client(&app, &uri, ssh, proxy, connection_id).await?;
    let session = Session { read_only, label: label.unwrap_or_default(), environment: environment.unwrap_or_default(), ..opened };
    state.insert_session(session_id, session).await;
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
pub async fn test_connection(
    app: AppHandle,
    uri: String,
    ssh: Option<SshTunnelConfig>,
    proxy: Option<ProxyConfig>,
    connection_id: Option<u32>,
) -> Result<(), AppError> {
    open_client(&app, &uri, ssh, proxy, connection_id).await?;
    Ok(())
}

/// Health probe for a live session: one `ping` with a hard deadline. The UI calls it every 30 s;
/// a failure marks the session degraded (the driver itself recovers topology on its own).
#[tauri::command]
pub async fn session_ping(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    let res = match tokio::time::timeout(PING_TIMEOUT, client.database("admin").run_command(doc! { "ping": 1 })).await {
        Err(_) => Err(AppError::Connection("ping timed out".into())),
        Ok(r) => r.map(|_| ()).map_err(|e| AppError::Connection(e.to_string())),
    };
    if res.is_err() {
        // Name the real cause: the SSH tunnel under the session, not the driver's generic timeout.
        // The message is exactly `host:port` of the SSH server; the UI wraps it in a localized sentence.
        if let Some(endpoint) = state.tunnel_down(&session_id).await {
            return Err(AppError::SshTunnel(endpoint));
        }
    }
    res
}

const PING_TIMEOUT: Duration = Duration::from_secs(10);

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
    Ok(config_dir(app)?.join("connections.json"))
}

pub(crate) fn known_hosts_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(config_dir(app)?.join("known_hosts.json"))
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

pub(crate) fn vault_ctx<'a>(app: &AppHandle, session: &'a VaultSession) -> Result<VaultCtx<'a>, AppError> {
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
        secrets::seal_list(&mut file, &list, &held, ctx, use_vault)?;
        registry::save(path, &file)?;
        let flags: Vec<bool> = file.iter().map(|c| c.secrets_in_keychain).collect();
        for (c, f) in list.iter_mut().zip(flags) {
            c.secrets_in_keychain = f;
        }
    }
    Ok((list.clone(), list, locked, held))
}

/// Applies `change` to the full registry and saves it, keeping secrets in the credential store.
/// `drop_held`: a connection whose held (sealed, unreadable) secrets must not be restored on this save.
fn update_registry_at(
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

/// One registry / vault operation at a time: each is a load-modify-save of `connections.json`.
static REGISTRY_IO: Mutex<()> = Mutex::new(());

/// Runs registry and vault work (OS keychain calls, Argon2id key derivation, file I/O) on the
/// blocking pool instead of Tauri's main thread, serialized by `REGISTRY_IO`.
async fn registry_job<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, &VaultSession) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    blocking(move || {
        let _io = lock_recover(&REGISTRY_IO);
        let vault = app.state::<VaultSession>();
        f(&app, &vault)
    })
    .await
}

/// `update_registry_at` on the app's registry file and credential store.
fn update_app_registry(
    app: &AppHandle,
    vault: &VaultSession,
    drop_held: Option<u32>,
    change: impl FnOnce(Vec<SavedConnection>) -> Vec<SavedConnection>,
) -> Result<Vec<SavedConnection>, AppError> {
    update_registry_at(&registry_path(app)?, &OsKeychain, &vault_ctx(app, vault)?, drop_held, change)
}

#[tauri::command]
pub async fn list_connections(app: AppHandle) -> Result<Vec<SavedConnection>, AppError> {
    registry_job(app, |app, vault| Ok(load_full(&registry_path(app)?, &OsKeychain, &vault_ctx(app, vault)?)?.1)).await
}

#[tauri::command]
pub async fn save_connection(
    app: AppHandle,
    id: Option<u32>,
    input: ConnectionInput,
    clear_secrets: Option<bool>,
) -> Result<Vec<SavedConnection>, AppError> {
    // "Save without password": the user chose no secret, so sealed values held for this connection go too.
    let drop_held = if clear_secrets == Some(true) { id } else { None };
    registry_job(app, move |app, vault| update_app_registry(app, vault, drop_held, |list| registry::upsert(list, id, input))).await
}

#[tauri::command]
pub async fn delete_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    registry_job(app, move |app, vault| {
        // A deleted connection must not leave its OIDC refresh token behind.
        oidc_human::TokenPersist::forget(&AppTokens { app: app.clone(), id });
        // ...nor its encryption settings and KMS credentials.
        csfle::forget_connection(app, vault, id);
        update_app_registry(app, vault, None, |list| registry::remove(list, id))
    })
    .await
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

/// Unlocks the vault; a wrong password is an error of kind `Vault`. Argon2id runs off the main thread.
#[tauri::command]
pub async fn vault_unlock(app: AppHandle, password: String) -> Result<(), AppError> {
    let password = zeroize::Zeroizing::new(password);
    registry_job(app, move |app, vault| secrets::vault_unlock(&vault_ctx(app, vault)?, &registry_path(app)?, &password)).await
}

/// First-time setup: creates the vault with `password` and seals the secrets already in the file.
#[tauri::command]
pub async fn vault_setup(app: AppHandle, password: String) -> Result<(), AppError> {
    let password = zeroize::Zeroizing::new(password);
    registry_job(app, move |app, vault| secrets::vault_setup(&vault_ctx(app, vault)?, &registry_path(app)?, &password)).await
}

/// "Forgot master password": deletes the vault and every sealed secret. Connections stay, with
/// empty passwords. Irreversible.
#[tauri::command]
pub async fn vault_reset(app: AppHandle) -> Result<(), AppError> {
    registry_job(app, |app, vault| {
        let r = secrets::vault_reset(&vault_ctx(app, vault)?, &registry_path(app)?);
        app.state::<crate::commands::atlas::AtlasState>().clear(); // cached Service Account clients hold a secret from before the reset
        r
    })
    .await
}

/// Stamp a saved connection's last-connected time after a successful `connect`; failures here must never block the connect flow (see `sessionManager.focusOrOpen`).
#[tauri::command]
pub async fn touch_connection(app: AppHandle, id: u32) -> Result<Vec<SavedConnection>, AppError> {
    registry_job(app, move |app, vault| update_app_registry(app, vault, None, |list| registry::touch(list, id, now_ms()))).await
}

#[cfg(test)]
mod oidc_tests {
    use super::*;

    async fn opts(uri: &str) -> ClientOptions {
        ClientOptions::parse(uri).await.unwrap()
    }

    #[tokio::test]
    async fn only_oidc_without_an_environment_needs_the_browser_flow() {
        assert!(needs_human_oidc(&opts("mongodb://h/?authMechanism=MONGODB-OIDC").await));
        assert!(needs_human_oidc(&opts("mongodb://me%40x.com@h/?authMechanism=MONGODB-OIDC&authSource=%24external").await));
        assert!(!needs_human_oidc(&opts("mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:k8s").await));
        assert!(!needs_human_oidc(&opts("mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api%3A%2F%2Fx").await));
        assert!(!needs_human_oidc(&opts("mongodb://u:p@h/").await));
    }

    #[tokio::test]
    async fn the_frontend_workload_uri_reaches_the_driver_intact() {
        let o = opts("mongodb://client-1@h/?authSource=%24external&authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api%3A%2F%2Fmy-app%2F.default").await;
        let c = o.credential.unwrap();
        let props = c.mechanism_properties.unwrap();
        assert_eq!((props.get_str("ENVIRONMENT").unwrap(), props.get_str("TOKEN_RESOURCE").unwrap()), ("azure", "api://my-app/.default"));
        assert_eq!(c.username.as_deref(), Some("client-1"));
    }

    #[tokio::test]
    async fn workload_environments_parse_with_the_enabled_driver_features() {
        for env in ["azure,TOKEN_RESOURCE:api%3A%2F%2Fx", "gcp,TOKEN_RESOURCE:https%3A%2F%2Fx", "k8s"] {
            let o = opts(&format!("mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:{env}")).await;
            assert!(o.credential.is_some(), "{env}");
        }
    }
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
        let saved = update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        assert_eq!(saved[0].password_enc, "enc-secret"); // the frontend still gets it back
        assert!(saved[0].secrets_in_keychain);
        let on_disk = std::fs::read_to_string(&path).unwrap();
        assert!(!on_disk.contains("enc-secret"));

        let listed = load_full(&path, &store, &ctx(&path, &session)).unwrap().1;
        assert_eq!(listed[0].password_enc, "enc-secret");

        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::touch(l, 1, 7)).unwrap();
        assert_eq!(*store.writes.borrow(), 1); // a touch never rewrites the credential

        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::remove(l, 1)).unwrap();
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
        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input(""))).unwrap();
        assert_eq!(load_full(&path, &store, &ctx(&path, &session)).unwrap().1.len(), 1);
        // A secret needs the vault first (see the refusal tests below).
        assert!(update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input("enc-secret"))).is_err());
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
        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::touch(l, 1, 2)).unwrap();
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
        update_registry_at(&path, &store, &ctx(&path, &restarted), None, |l| registry::touch(l, 1, 9)).unwrap();
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
        let r = update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input("typed-pw")));
        assert_eq!(vault_code(r), "vault_uninitialized");
        assert!(!path.exists(), "nothing may be written");

        // Without the password the connection saves fine.
        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input(""))).unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("typed-pw"));

        // Changing a legacy plain value is refused too; leaving it alone is not.
        let path = legacy_file("refuse_uninit_edit", "old");
        let edit = |pw: &'static str| move |mut l: Vec<SavedConnection>| {
            l[0].password_enc = pw.into();
            l
        };
        assert_eq!(vault_code(update_registry_at(&path, &store, &ctx(&path, &session), None, edit("changed"))), "vault_uninitialized");
        update_registry_at(&path, &store, &ctx(&path, &session), None, edit("old")).unwrap();
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
        let r = update_registry_at(&path, &store, &ctx(&path, &locked), None, |mut l| {
            l[0].password_enc = "typed-pw".into();
            l
        });
        assert_eq!(vault_code(r), "vault_locked");
        // A brand-new connection with a secret: refused as well.
        let r = update_registry_at(&path, &store, &ctx(&path, &locked), None, |l| registry::upsert(l, None, input("typed-pw")));
        assert_eq!(vault_code(r), "vault_locked");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
        assert!(!std::fs::read_to_string(&path).unwrap().contains("typed-pw"));

        // Saving without a password works and keeps the sealed secrets of other connections.
        update_registry_at(&path, &store, &ctx(&path, &locked), None, |l| registry::upsert(l, None, input(""))).unwrap();
        let list = registry::load(&path).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].password_enc.starts_with("vault:v1:"));

        // Once unlocked the same save goes through, sealed.
        secrets::vault_unlock(&ctx(&path, &locked), &path, MASTER).unwrap();
        update_registry_at(&path, &store, &ctx(&path, &locked), None, |l| registry::upsert(l, Some(2), input("typed-pw"))).unwrap();
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
        update_registry_at(&path, &store, &ctx(&path, &locked), None, blank).unwrap();
        assert!(registry::load(&path).unwrap()[0].password_enc.starts_with("vault:v1:"));
        // …but an explicit "save without password" really removes it.
        update_registry_at(&path, &store, &ctx(&path, &locked), Some(1), blank).unwrap();
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
        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::upsert(l, None, input("enc-secret"))).unwrap();
        load_full(&path, &store, &ctx(&path, &session)).unwrap();
        assert!(!path.with_file_name("vault.json").exists());
        assert!(!std::fs::read_to_string(&path).unwrap().contains("vault:v1:"));
        // Even a key left in memory is not used to seal anything while a credential store exists.
        let (v, _) = crate::vault::Vault::create("x").unwrap();
        session.set(v);
        update_registry_at(&path, &store, &ctx(&path, &session), None, |l| registry::touch(l, 1, 3)).unwrap();
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
        list[0].proxy_password_enc = "p5".into();
        list[0].aws_session_token_enc = "p6".into();
        registry::save(&path, &list).unwrap();
        let session = VaultSession::default();
        secrets::vault_setup(&ctx(&path, &session), &path, MASTER).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        for plain in ["p1", "p2", "p3", "p4", "p5", "p6"] {
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

#[cfg(test)]
mod aws_integration {
    use super::*;

    /// Needs a MongoDB with MONGODB-AWS enabled (e.g. Atlas) and AWS credentials in the environment or in the URI:
    /// `LUMIO_TEST_AWS_URI='mongodb+srv://<cluster>/?authMechanism=MONGODB-AWS&authSource=%24external' cargo test -- --ignored aws`
    #[tokio::test]
    #[ignore = "needs LUMIO_TEST_AWS_URI"]
    async fn aws_iam_authenticates() {
        let uri = std::env::var("LUMIO_TEST_AWS_URI").expect("set LUMIO_TEST_AWS_URI");
        let opts = ClientOptions::parse(&uri).await.unwrap();
        let client = Client::with_options(opts).unwrap();
        client.database("admin").run_command(doc! { "ping": 1 }).await.unwrap();
    }
}
