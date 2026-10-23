//! Client-Side Field Level Encryption commands. The settings and KMS credentials of a connection are
//! managed here without the `csfle` feature too (pure, testable); everything that needs
//! libmongocrypt is behind `#[cfg(feature = "csfle")]` and answers "not available" otherwise.
//! Key material and credentials never leave this module in a return value, a log line or an audit record.
use crate::commands::connection::{registry_path, vault_ctx};
use crate::csfle::{self, CsfleConfig, CsfleView, DataKeyInfo, KmsInput, KmsSecrets};
use crate::error::AppError;
use crate::secrets::{self, NamedSecretStore, OsKeychain, VaultCtx};
use crate::state::AppState;
use crate::vault::VaultSession;
use std::path::{Path, PathBuf};
use crate::csfle_guard::{encrypted_paths, has_encrypted_values, needs_decryption, restore_ciphertext, update_conflicts, PLAINTEXT_REQUIRED};
use mongodb::bson::Document;
use mongodb::Client;
use tauri::{AppHandle, State};

/// Whether this build contains CSFLE support (libmongocrypt linked). The UI hides the feature otherwise.
#[tauri::command]
pub fn csfle_available() -> bool {
    cfg!(feature = "csfle")
}

pub(crate) const NOT_AVAILABLE: &str = "Client-side field level encryption is not available in this build";

pub(crate) fn not_available() -> AppError {
    AppError::Query(NOT_AVAILABLE.into())
}

fn csfle_file_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(registry_path(app)?.with_file_name("csfle.json"))
}

// ---- the per-session handle -----------------------------------------------------------------------

/// What a session keeps for explicit encryption; dropped with the session.
#[cfg(feature = "csfle")]
pub struct CsfleHandle {
    pub enc: mongodb::client_encryption::ClientEncryption,
    pub config: CsfleConfig,
}

#[cfg(not(feature = "csfle"))]
pub struct CsfleHandle;

/// Settings and credentials ready to build an encrypting client (loaded before connecting).
#[cfg_attr(not(feature = "csfle"), allow(dead_code))] // only `build_client` reads them
pub struct Prepared {
    pub config: CsfleConfig,
    pub secrets: KmsSecrets,
}

/// Loads the connection's CSFLE setup if it is enabled. `Ok(None)`: not configured (or this build has no CSFLE).
pub(crate) fn prepare(app: &AppHandle, vault: &VaultSession, connection_id: Option<u32>) -> Result<Option<Prepared>, AppError> {
    let Some(id) = connection_id else { return Ok(None) };
    if !cfg!(feature = "csfle") {
        return Ok(None);
    }
    prepare_at(&csfle_file_path(app)?, &OsKeychain, &vault_ctx(app, vault)?, id)
}

fn prepare_at(file: &Path, store: &dyn NamedSecretStore, ctx: &VaultCtx, id: u32) -> Result<Option<Prepared>, AppError> {
    let Some(config) = csfle::load_file(file)?.remove(&id.to_string()).filter(|c| c.enabled) else { return Ok(None) };
    config.validate()?;
    let json = match secrets::csfle_secret_load(store, ctx, id) {
        Some(j) => j,
        None if secrets::csfle_secret_exists(store, ctx, id) => return Err(AppError::Vault("vault_locked".into())),
        None => return Err(AppError::Query("Encryption is enabled but no KMS credentials are stored".into())),
    };
    Ok(Some(Prepared { config, secrets: KmsSecrets::from_json(&json)? }))
}

#[cfg(feature = "csfle")]
impl Prepared {
    /// The session client with automatic decryption, plus the explicit-encryption handle.
    pub(crate) async fn build_client(self, opts: mongodb::options::ClientOptions) -> Result<(mongodb::Client, CsfleHandle), AppError> {
        let client = crate::csfle_engine::auto_decrypting_client(opts, &self.config, &self.secrets).await?;
        let enc = crate::csfle_engine::client_encryption(client.clone(), &self.config, &self.secrets)?;
        Ok((client, CsfleHandle { enc, config: self.config }))
    }
}

// ---- settings --------------------------------------------------------------------------------------

fn view_at(file: &Path, store: &dyn NamedSecretStore, ctx: &VaultCtx, id: u32) -> Result<CsfleView, AppError> {
    let config = csfle::load_file(file)?.remove(&id.to_string()).unwrap_or_default();
    let stored_providers = if secrets::csfle_secret_exists(store, ctx, id) { config.providers.clone() } else { Vec::new() };
    Ok(CsfleView { config, stored_providers })
}

/// Saves the settings and, when `kms` carries credentials, merges them into the stored secret.
/// Returns where the secret ended up (`"keychain"`, `"vault"`, or `""` when there is none).
fn save_at(
    file: &Path,
    store: &dyn NamedSecretStore,
    ctx: &VaultCtx,
    id: u32,
    mut config: CsfleConfig,
    kms: KmsInput,
) -> Result<&'static str, AppError> {
    config.validate_shape()?;
    let existing = match secrets::csfle_secret_load(store, ctx, id) {
        Some(j) => Some(KmsSecrets::from_json(&j)?),
        // Credentials exist but cannot be read: refuse rather than silently drop them.
        None if secrets::csfle_secret_exists(store, ctx, id) => return Err(AppError::Vault("vault_locked".into())),
        None => None,
    };
    let merged = KmsSecrets::merged(existing, kms, &config.providers)?;
    config.providers = merged.configured().iter().map(|s| s.to_string()).collect();
    config.validate()?;
    let outcome = if merged.configured().is_empty() {
        secrets::csfle_secret_forget(store, ctx, id);
        ""
    } else {
        match secrets::csfle_secret_save(store, ctx, id, &merged.to_json()?)? {
            secrets::AtlasSecretOutcome::Keychain => "keychain",
            secrets::AtlasSecretOutcome::Vault => "vault",
        }
    };
    let mut all = csfle::load_file(file)?;
    all.insert(id.to_string(), config);
    csfle::save_file(file, &all)?;
    Ok(outcome)
}

fn clear_at(file: &Path, store: &dyn NamedSecretStore, ctx: &VaultCtx, id: u32) -> Result<(), AppError> {
    secrets::csfle_secret_forget(store, ctx, id);
    let mut all = csfle::load_file(file)?;
    if all.remove(&id.to_string()).is_some() {
        csfle::save_file(file, &all)?;
    }
    Ok(())
}

/// The connection's encryption settings and which providers have stored credentials (never the credentials).
#[tauri::command]
pub fn csfle_get(app: AppHandle, vault: State<'_, VaultSession>, connection_id: u32) -> Result<CsfleView, AppError> {
    view_at(&csfle_file_path(&app)?, &OsKeychain, &vault_ctx(&app, &vault)?, connection_id)
}

/// Saves the settings. `kms` holds only what the user typed this time; credentials not re-sent are kept
/// for the providers still listed in `config.providers`. Resolves with where the secret is stored.
#[tauri::command]
pub fn csfle_save(
    app: AppHandle,
    vault: State<'_, VaultSession>,
    connection_id: u32,
    config: CsfleConfig,
    kms: KmsInput,
) -> Result<&'static str, AppError> {
    if !cfg!(feature = "csfle") {
        return Err(not_available());
    }
    save_at(&csfle_file_path(&app)?, &OsKeychain, &vault_ctx(&app, &vault)?, connection_id, config, kms)
}

/// Forgets the encryption setup and its credentials when the connection is deleted (best effort:
/// never fails the delete).
pub(crate) fn forget_connection(app: &AppHandle, vault: &VaultSession, connection_id: u32) {
    if let (Ok(file), Ok(ctx)) = (csfle_file_path(app), vault_ctx(app, vault)) {
        let _ = clear_at(&file, &OsKeychain, &ctx, connection_id);
    }
}

/// Writes 96 random bytes to `path` (refusing to overwrite) for use as the `local` master key.
#[tauri::command]
pub fn csfle_generate_local_key(path: String) -> Result<(), AppError> {
    write_new_local_key(Path::new(&path))
}

fn write_new_local_key(path: &Path) -> Result<(), AppError> {
    use std::io::Write;
    let mut key = zeroize::Zeroizing::new([0u8; csfle::LOCAL_KEY_LEN]);
    getrandom::fill(key.as_mut_slice()).map_err(|e| AppError::Io(format!("random generator unavailable: {e}")))?;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).map_err(|e| AppError::Io(format!("Cannot create the key file: {e}")))?;
    f.write_all(key.as_slice()).and_then(|_| f.sync_all()).map_err(|e| AppError::Io(e.to_string()))
}

// ---- keeping ciphertext intact ---------------------------------------------------------------------

/// Loads the stored document (ciphertext via `raw`) and applies `restore_ciphertext` to `new_doc`; the
/// decrypted view is read through `client` only when needed (see `needs_decryption`). A document that
/// does not exist (yet) needs no guard.
pub(crate) async fn guard_replacement(
    raw: &Client,
    client: &Client,
    db: &str,
    coll: &str,
    filter: &Document,
    mut new_doc: Document,
    plaintext_ok: &[String],
) -> Result<Document, AppError> {
    let old_raw = raw.database(db).collection::<Document>(coll).find_one(filter.clone()).await?;
    let Some(old_raw) = old_raw else { return Ok(new_doc) };
    if !has_encrypted_values(&old_raw) {
        return Ok(new_doc);
    }
    let old_dec = if needs_decryption(&new_doc, &old_raw) {
        client.database(db).collection::<Document>(coll).find_one(filter.clone()).await?.unwrap_or_default()
    } else {
        Document::new()
    };
    restore_ciphertext(&mut new_doc, &old_raw, &old_dec, plaintext_ok).map_err(|paths| AppError::Query(format!("{PLAINTEXT_REQUIRED}{}", paths.join(","))))?;
    Ok(new_doc)
}

/// Refuses an `update_one` that would overwrite, unset, rename or rewrite an encrypted field (the
/// stored ciphertext cannot be edited in place), unless the path was confirmed as plain text.
pub(crate) async fn guard_update(raw: &Client, db: &str, coll: &str, filter: &Document, update: &Document, plaintext_ok: &[String]) -> Result<(), AppError> {
    let Some(old_raw) = raw.database(db).collection::<Document>(coll).find_one(filter.clone()).await? else { return Ok(()) };
    let pending: Vec<String> = update_conflicts(update, &old_raw).into_iter().filter(|p| !plaintext_ok.contains(p)).collect();
    if pending.is_empty() { Ok(()) } else { Err(AppError::Query(format!("{PLAINTEXT_REQUIRED}{}", pending.join(",")))) }
}

/// The BinData subtype 6 paths of one stored document (read without decrypting), for the editor's
/// "Encrypted" badges. Empty when the document does not exist.
#[tauri::command]
pub async fn csfle_encrypted_paths(session_id: String, db: String, coll: String, id_json: String, state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let raw = state.raw_client(&session_id).await?;
    let id = crate::json_bson::canonical_string_to_bson(&id_json)?;
    let found = raw.database(&db).collection::<Document>(&coll).find_one(mongodb::bson::doc! { "_id": id }).await?;
    Ok(found.map(|d| encrypted_paths(&d)).unwrap_or_default())
}

// ---- reads that survive an undecryptable field ------------------------------------------------------

/// Event sent to the UI when a read had to fall back to the raw client: `{ sessionId, reason }`
/// (reason is the libmongocrypt text; the UI maps it to a localized message).
pub const DECRYPT_EVENT: &str = "csfle-decrypt-unavailable";

/// Runs a read with the decrypting client; if libmongocrypt cannot decrypt (a key is gone, the KMS is
/// unreachable, wrong credentials) the same read runs again on the raw client and the reason is
/// returned next to the result. Without a raw client (no encryption) this is just `run(client)`.
pub async fn read_with_fallback<T, F, Fut>(client: Client, raw: Option<Client>, run: F) -> (Result<T, AppError>, Option<String>)
where
    F: Fn(Client) -> Fut,
    Fut: std::future::Future<Output = Result<T, AppError>>,
{
    match (run(client).await, raw) {
        (Err(e), Some(raw)) if e.is_encryption() => {
            let reason = match &e {
                AppError::Query(m) => m.clone(),
                other => other.to_string(),
            };
            (run(raw).await, Some(reason))
        }
        (res, _) => (res, None),
    }
}

/// Event sent after a read on an encrypting session that decrypted fine (clears the banner).
pub const DECRYPT_OK_EVENT: &str = "csfle-decrypt-ok";

/// Tells the UI how a read on a session went: a fallback raises the banner, a clean read of an
/// encrypting session (`encrypting`) clears it. Sessions without encryption emit nothing.
pub fn notify_read(app: &AppHandle, session_id: &str, fell_back: Option<&str>, encrypting: bool) {
    use tauri::Emitter;
    match fell_back {
        Some(reason) => notify_fallback(app, session_id, reason),
        None if encrypting => {
            let _ = app.emit(DECRYPT_OK_EVENT, serde_json::json!({ "sessionId": session_id }));
        }
        None => {}
    }
}

/// Tells the UI a read fell back (best effort).
pub fn notify_fallback(app: &AppHandle, session_id: &str, reason: &str) {
    use tauri::Emitter;
    let _ = app.emit(DECRYPT_EVENT, serde_json::json!({ "sessionId": session_id, "reason": crate::redact::redact_text(reason) }));
}

// ---- live session: keys and explicit encryption ---------------------------------------------------

/// Whether the session was opened with encryption (the editor shows "Encrypt with key…" only then).
#[tauri::command]
pub async fn csfle_session_enabled(session_id: String, state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state.sessions.lock().await.get(&session_id).is_some_and(|s| s.csfle.is_some()))
}

#[cfg(feature = "csfle")]
async fn handle_of(state: &AppState, session_id: &str) -> Result<std::sync::Arc<CsfleHandle>, AppError> {
    state
        .sessions
        .lock()
        .await
        .get(session_id)
        .and_then(|s| s.csfle.clone())
        .ok_or_else(|| AppError::Query("This connection has no encryption configured. Enable it in the connection's encryption settings and reconnect.".into()))
}

/// The data keys in the connection's key vault.
#[tauri::command]
pub async fn csfle_list_keys(session_id: String, state: State<'_, AppState>) -> Result<Vec<DataKeyInfo>, AppError> {
    #[cfg(feature = "csfle")]
    {
        let h = handle_of(&state, &session_id).await?;
        crate::csfle_engine::list_keys(&h.enc).await
    }
    #[cfg(not(feature = "csfle"))]
    {
        let _ = (session_id, state);
        Err(not_available())
    }
}

/// Creates a data key (a write to the key vault: refused on read-only sessions, audited). Returns its id.
#[tauri::command]
pub async fn csfle_create_data_key(
    session_id: String,
    provider: String,
    alt_name: Option<String>,
    master_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    #[cfg(feature = "csfle")]
    {
        state.ensure_writable(&session_id).await?;
        let h = handle_of(&state, &session_id).await?;
        let master = crate::csfle_engine::master_key(&provider, master_key.as_deref())?;
        let ns = h.config.key_vault_namespace.clone();
        state
            .audited(&session_id, crate::audit::SOURCE_UI, "createDataKey", &ns, None, |_| Some(1), crate::csfle_engine::create_data_key(&h.enc, master, alt_name.as_deref()))
            .await
    }
    #[cfg(not(feature = "csfle"))]
    {
        let _ = (session_id, provider, alt_name, master_key, state);
        Err(not_available())
    }
}

/// Encrypts one value for the editor. `value` is Canonical Extended JSON of the value; the result is
/// Canonical Extended JSON of the encrypted BinData (subtype 6), ready to put into the document. Nothing
/// is written here: the document is saved through the normal insert/replace path (audit, PROD gate).
#[tauri::command]
pub async fn csfle_encrypt(
    session_id: String,
    value: String,
    key_id: Option<String>,
    key_alt_name: Option<String>,
    algorithm: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let algo = csfle::parse_algorithm(&algorithm)?;
    #[cfg(feature = "csfle")]
    {
        let h = handle_of(&state, &session_id).await?;
        let v = crate::json_bson::canonical_string_to_bson(&value)?;
        let bin = crate::csfle_engine::encrypt_value(&h.enc, v, key_id.as_deref(), key_alt_name.as_deref(), algo).await?;
        crate::bson_json::bson_to_canonical_string(&mongodb::bson::Bson::Binary(bin))
    }
    #[cfg(not(feature = "csfle"))]
    {
        let _ = (session_id, value, key_id, key_alt_name, algo, state);
        Err(not_available())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csfle::{AwsCreds, KmipCreds};
    use crate::vault::{Vault, VaultSession};
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct Mem {
        items: RefCell<HashMap<String, String>>,
    }
    impl NamedSecretStore for Mem {
        fn named_available(&self) -> bool {
            true
        }
        fn named_get(&self, a: &str) -> Result<Option<String>, String> {
            Ok(self.items.borrow().get(a).cloned())
        }
        fn named_set(&self, a: &str, v: &str) -> Result<(), String> {
            self.items.borrow_mut().insert(a.into(), v.into());
            Ok(())
        }
        fn named_delete(&self, a: &str) -> Result<(), String> {
            self.items.borrow_mut().remove(a);
            Ok(())
        }
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumiong_csfle_cmd_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn aws() -> KmsInput {
        KmsInput { aws: Some(AwsCreds { access_key_id: "AKIA".into(), secret_access_key: "AWS-SECRET-VALUE".into(), session_token: String::new() }), ..Default::default() }
    }

    fn cfg(providers: &[&str]) -> CsfleConfig {
        CsfleConfig { enabled: true, providers: providers.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    #[test]
    fn saving_keeps_credentials_out_of_the_settings_file_and_the_view() {
        let d = dir("save");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let store = Mem::default();
        assert_eq!(save_at(&file, &store, &ctx, 3, cfg(&["aws"]), aws()).unwrap(), "keychain");
        let on_disk = std::fs::read_to_string(&file).unwrap();
        assert!(!on_disk.contains("AWS-SECRET-VALUE") && !on_disk.contains("AKIA"), "{on_disk}");
        assert!(store.items.borrow()["csfle-3"].contains("AWS-SECRET-VALUE"));
        let view = serde_json::to_string(&view_at(&file, &store, &ctx, 3).unwrap()).unwrap();
        assert!(!view.contains("AWS-SECRET-VALUE") && view.contains("\"aws\""), "{view}");
    }

    #[test]
    fn credentials_not_resent_are_kept_and_removed_providers_are_dropped() {
        let d = dir("keep");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let store = Mem::default();
        save_at(&file, &store, &ctx, 1, cfg(&["aws"]), aws()).unwrap();
        // Only the namespace changes: AWS stays configured without being re-sent.
        let mut c = cfg(&["aws"]);
        c.key_vault_namespace = "kv.keys".into();
        save_at(&file, &store, &ctx, 1, c, KmsInput::default()).unwrap();
        let v = view_at(&file, &store, &ctx, 1).unwrap();
        assert_eq!((v.config.key_vault_namespace.as_str(), v.stored_providers.clone()), ("kv.keys", vec!["aws".to_string()]));
        // Dropping the provider removes its credentials, and with them the whole secret.
        save_at(&file, &store, &ctx, 1, cfg(&[]), KmsInput::default()).unwrap_err(); // enabled without providers
        let mut off = cfg(&[]);
        off.enabled = false;
        assert_eq!(save_at(&file, &store, &ctx, 1, off, KmsInput::default()).unwrap(), "");
        assert!(store.items.borrow().is_empty());
        assert!(view_at(&file, &store, &ctx, 1).unwrap().stored_providers.is_empty());
    }

    #[test]
    fn prepare_needs_enabled_settings_and_stored_credentials() {
        let d = dir("prepare");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let store = Mem::default();
        assert!(prepare_at(&file, &store, &ctx, 9).unwrap().is_none(), "no settings at all");
        save_at(&file, &store, &ctx, 9, cfg(&["aws"]), aws()).unwrap();
        let p = prepare_at(&file, &store, &ctx, 9).unwrap().unwrap();
        assert_eq!(p.secrets.configured(), vec!["aws"]);
        store.items.borrow_mut().clear();
        assert!(prepare_at(&file, &store, &ctx, 9).is_err(), "enabled but the credentials are gone");
        let mut off = cfg(&["aws"]);
        off.enabled = false;
        csfle::save_file(&file, &[("9".to_string(), off)].into_iter().collect()).unwrap();
        assert!(prepare_at(&file, &store, &ctx, 9).unwrap().is_none(), "disabled settings are ignored");
    }

    #[test]
    fn clear_removes_settings_and_credentials() {
        let d = dir("clear");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let store = Mem::default();
        save_at(&file, &store, &ctx, 2, cfg(&["aws"]), aws()).unwrap();
        clear_at(&file, &store, &ctx, 2).unwrap();
        assert!(!file.exists() && store.items.borrow().is_empty());
        clear_at(&file, &store, &ctx, 2).unwrap();
    }

    #[test]
    fn a_locked_vault_refuses_to_replace_sealed_credentials() {
        let d = dir("locked");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let (vault, vfile) = Vault::create("correct horse").unwrap();
        crate::vault::write_file(&ctx.path, &vfile).unwrap();
        session.set(vault);
        // No credential store: the secret is sealed into csfle_secrets.json.
        struct NoStore;
        impl NamedSecretStore for NoStore {
            fn named_available(&self) -> bool {
                false
            }
            fn named_get(&self, _: &str) -> Result<Option<String>, String> {
                Ok(None)
            }
            fn named_set(&self, _: &str, _: &str) -> Result<(), String> {
                Err("no".into())
            }
            fn named_delete(&self, _: &str) -> Result<(), String> {
                Ok(())
            }
        }
        assert_eq!(save_at(&file, &NoStore, &ctx, 4, cfg(&["aws"]), aws()).unwrap(), "vault");
        assert!(!std::fs::read_to_string(d.join("csfle_secrets.json")).unwrap().contains("AWS-SECRET-VALUE"));
        session.clear();
        let err = save_at(&file, &NoStore, &ctx, 4, cfg(&["aws"]), KmsInput::default()).unwrap_err();
        assert!(matches!(err, AppError::Vault(c) if c == "vault_locked"));
        assert!(matches!(prepare_at(&file, &NoStore, &ctx, 4), Err(AppError::Vault(_))));
    }

    #[test]
    fn kmip_credentials_round_trip_through_the_stored_secret() {
        let d = dir("kmip");
        let file = d.join("csfle.json");
        let session = VaultSession::default();
        let ctx = VaultCtx { path: d.join("vault.json"), session: &session };
        let store = Mem::default();
        let kms = KmsInput { kmip: Some(KmipCreds { endpoint: "k:5696".into(), cert_password: "CERT-PW".into(), ..Default::default() }), ..Default::default() };
        save_at(&file, &store, &ctx, 6, cfg(&["kmip"]), kms).unwrap();
        let p = prepare_at(&file, &store, &ctx, 6).unwrap().unwrap();
        assert_eq!(p.secrets.kmip.unwrap().cert_password, "CERT-PW");
        assert!(!std::fs::read_to_string(&file).unwrap().contains("CERT-PW"));
    }

    #[test]
    fn generated_local_key_is_96_bytes_and_never_overwritten() {
        let d = dir("genkey");
        let path = d.join("local.key");
        write_new_local_key(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap().len(), 96);
        assert!(csfle::read_local_key_file(path.to_str().unwrap()).is_ok());
        assert!(write_new_local_key(&path).is_err(), "must not overwrite an existing key");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    fn lazy(db: &str) -> Client {
        futures::executor::block_on(async { Client::with_uri_str(format!("mongodb://127.0.0.1:1/{db}")).await.unwrap() })
    }
    fn db_of(c: &Client) -> String {
        c.default_database().unwrap().name().to_string()
    }

    #[tokio::test]
    async fn a_decryption_failure_falls_back_to_the_raw_client_and_reports_why() {
        let run = |c: Client| async move {
            if db_of(&c) == "decrypting" { Err(AppError::Query(format!("{}key not found in key vault", crate::error::ENCRYPTION_PREFIX))) } else { Ok(db_of(&c)) }
        };
        let (res, reason) = read_with_fallback(lazy("decrypting"), Some(lazy("raw")), run).await;
        assert_eq!(res.unwrap(), "raw");
        assert!(reason.unwrap().contains("key not found"));
        // Other errors are not retried, a session without encryption has nowhere to fall back to.
        let boom = |_c: Client| async { Err::<String, _>(AppError::Query("network".into())) };
        let (res, reason) = read_with_fallback(lazy("decrypting"), Some(lazy("raw")), boom).await;
        assert!(res.is_err() && reason.is_none());
        let (res, reason) = read_with_fallback(lazy("decrypting"), None, run).await;
        assert!(res.is_err() && reason.is_none());
        // A healthy read reports nothing.
        let (res, reason) = read_with_fallback(lazy("fine"), Some(lazy("raw")), run).await;
        assert_eq!((res.unwrap().as_str(), reason), ("fine", None));
    }
}
