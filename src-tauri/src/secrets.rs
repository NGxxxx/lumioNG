//! Keeps saved-connection secrets (passwords, passphrases) in the OS credential store instead of
//! `connections.json`: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
//!
//! One credential per connection (service `LumioNG`, account `connection-<id>`) holding the four
//! secret fields as JSON. The values are the frontend's obfuscated `*Enc` strings, so the IPC
//! contract is unchanged: the frontend still sends and receives them exactly as before. When no
//! credential store is available (e.g. a Linux session without a Secret Service), secrets stay in
//! the file, sealed by the master-password vault (`vault.rs`, see the bottom half of this module)
//! once the user has set one up, and merely obfuscated until then.

use crate::registry::SavedConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

pub const SERVICE: &str = "LumioNG";

/// Where secrets of a saved connection live.
pub trait SecretStore {
    /// Whether the store can be used at all (checked before migrating).
    fn available(&self) -> bool;
    /// `Ok(None)` when there is no credential for `id`.
    fn get(&self, id: u32) -> Result<Option<String>, String>;
    fn set(&self, id: u32, value: &str) -> Result<(), String>;
    /// Deleting a credential that does not exist is not an error.
    fn delete(&self, id: u32) -> Result<(), String>;
}

/// The platform credential store.
pub struct OsKeychain;

/// Set after the first platform failure (store locked, unlock prompt dismissed, no service): the
/// store is then left alone until the next launch instead of prompting on every registry access.
static FAILED: AtomicBool = AtomicBool::new(false);

fn account(id: u32) -> String {
    format!("connection-{id}")
}

/// Runs one store call; any error other than "no such credential" latches `FAILED`.
fn guarded<T>(id: u32, call: impl FnOnce(&keyring::Entry) -> keyring::Result<T>) -> Result<Option<T>, String> {
    guarded_account(&account(id), call)
}

fn guarded_account<T>(account: &str, call: impl FnOnce(&keyring::Entry) -> keyring::Result<T>) -> Result<Option<T>, String> {
    if FAILED.load(Ordering::Relaxed) {
        return Err("credential store unavailable".into());
    }
    let result = keyring::Entry::new(SERVICE, account).and_then(|e| call(&e));
    match result {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            FAILED.store(true, Ordering::Relaxed);
            Err(e.to_string())
        }
    }
}

impl SecretStore for OsKeychain {
    fn available(&self) -> bool {
        !FAILED.load(Ordering::Relaxed) && keyring::Entry::store_status().is_ok()
    }
    fn get(&self, id: u32) -> Result<Option<String>, String> {
        guarded(id, |e| e.get_password())
    }
    fn set(&self, id: u32, value: &str) -> Result<(), String> {
        guarded(id, |e| e.set_password(value)).map(|_| ())
    }
    fn delete(&self, id: u32) -> Result<(), String> {
        guarded(id, |e| e.delete_credential()).map(|_| ())
    }
}

/// OIDC refresh tokens: one credential per connection id (account `oidc-refresh-<id>`), kept apart
/// from the connection secrets so saving or clearing a connection never touches them.
pub trait TokenStore: SecretStore {
    fn token_get(&self, id: u32) -> Result<Option<String>, String>;
    fn token_set(&self, id: u32, value: &str) -> Result<(), String>;
    fn token_delete(&self, id: u32) -> Result<(), String>;
}

fn token_account(id: u32) -> String {
    format!("oidc-refresh-{id}")
}

impl TokenStore for OsKeychain {
    fn token_get(&self, id: u32) -> Result<Option<String>, String> {
        guarded_account(&token_account(id), |e| e.get_password())
    }
    fn token_set(&self, id: u32, value: &str) -> Result<(), String> {
        guarded_account(&token_account(id), |e| e.set_password(value)).map(|_| ())
    }
    fn token_delete(&self, id: u32) -> Result<(), String> {
        guarded_account(&token_account(id), |e| e.delete_credential()).map(|_| ())
    }
}

/// The secret fields of a connection, as stored in one credential.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Secrets {
    pub password_enc: String,
    pub tls_certificate_key_file_password_enc: String,
    pub ssh_password_enc: String,
    pub ssh_passphrase_enc: String,
    pub proxy_password_enc: String,
    pub aws_session_token_enc: String,
}

impl Secrets {
    pub fn of(c: &SavedConnection) -> Self {
        Secrets {
            password_enc: c.password_enc.clone(),
            tls_certificate_key_file_password_enc: c.tls_certificate_key_file_password_enc.clone(),
            ssh_password_enc: c.ssh_password_enc.clone(),
            ssh_passphrase_enc: c.ssh_passphrase_enc.clone(),
            proxy_password_enc: c.proxy_password_enc.clone(),
            aws_session_token_enc: c.aws_session_token_enc.clone(),
        }
    }
    pub fn is_empty(&self) -> bool {
        *self == Secrets::default()
    }
    fn apply(self, c: &mut SavedConnection) {
        c.password_enc = self.password_enc;
        c.tls_certificate_key_file_password_enc = self.tls_certificate_key_file_password_enc;
        c.ssh_password_enc = self.ssh_password_enc;
        c.ssh_passphrase_enc = self.ssh_passphrase_enc;
        c.proxy_password_enc = self.proxy_password_enc;
        c.aws_session_token_enc = self.aws_session_token_enc;
    }
}

/// Connections whose credential exists but could not be read this time (store locked or gone).
pub type Locked = HashSet<u32>;

/// Fills in the secrets of every connection kept in the store. A connection whose credential has
/// vanished drops its flag; one whose credential can't be read now is reported in `Locked` and keeps
/// its flag, so a later save doesn't mistake "unreadable" for "cleared".
pub fn fill(list: &mut [SavedConnection], store: &dyn SecretStore) -> Locked {
    let mut locked = Locked::new();
    for c in list.iter_mut().filter(|c| c.secrets_in_keychain) {
        match store.get(c.id) {
            Ok(Some(json)) => match serde_json::from_str::<Secrets>(&json) {
                Ok(s) => s.apply(c),
                Err(_) => c.secrets_in_keychain = false,
            },
            Ok(None) => c.secrets_in_keychain = false,
            Err(_) => {
                locked.insert(c.id);
            }
        }
    }
    locked
}

/// Whether some connection still has secrets in the file that the store could take.
pub fn needs_migration(list: &[SavedConnection], store: &dyn SecretStore) -> bool {
    list.iter().any(|c| !c.secrets_in_keychain && !Secrets::of(c).is_empty()) && store.available()
}

/// Brings the store in line with `after` (the full list, secrets included) given `before` (as
/// loaded), and returns what goes into the file: secrets blanked for every connection kept in the
/// store, left in place where the store refused them.
pub fn sync(before: &[SavedConnection], after: &[SavedConnection], locked: &Locked, store: &dyn SecretStore) -> Vec<SavedConnection> {
    let mut file = Vec::with_capacity(after.len());
    for a in after {
        let mut c = a.clone();
        let secrets = Secrets::of(a);
        let prev = before.iter().find(|b| b.id == a.id);
        if locked.contains(&a.id) && secrets.is_empty() {
            // Unreadable right now: leave the credential alone.
        } else if secrets.is_empty() {
            if c.secrets_in_keychain {
                let _ = store.delete(c.id);
            }
            c.secrets_in_keychain = false;
        } else if c.secrets_in_keychain && prev.is_some_and(|b| b.secrets_in_keychain && Secrets::of(b) == secrets) {
            // Unchanged and already stored.
        } else {
            let json = serde_json::to_string(&secrets).unwrap_or_default();
            c.secrets_in_keychain = store.set(c.id, &json).is_ok();
        }
        if c.secrets_in_keychain {
            Secrets::default().apply(&mut c);
        }
        file.push(c);
    }
    for b in before.iter().filter(|b| b.secrets_in_keychain && !after.iter().any(|a| a.id == b.id)) {
        let _ = store.delete(b.id);
    }
    file
}

// ── Master-password vault for the file fallback ─────────────────────────────────────────────────
//
// Only when the OS has no credential store: every `*Enc` field written to `connections.json` is
// wrapped by the `Vault` (see `vault.rs`) and unwrapped on read. The fields are found by name
// (JSON keys ending in `Enc`), so a secret field added to `SavedConnection` later is covered
// without touching this code. With a credential store present nothing here opens or seals.

use crate::error::AppError;
use crate::registry;
use crate::vault::{self, Vault, VaultSession};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Sealed values that could not be opened this time (vault locked, or the value is damaged),
/// per connection as `(json field, original sealed text)`. They are blanked for the frontend and
/// put back on save, so an unrelated save never destroys them.
pub type Held = HashMap<u32, Vec<(String, String)>>;

/// Where the vault lives and whether its key is in memory.
pub struct VaultCtx<'a> {
    pub path: PathBuf,
    pub session: &'a VaultSession,
}

/// Applies `f(field, value)` to every non-empty string field whose JSON name ends in `Enc`;
/// `Some(new)` replaces the value. Returns whether anything changed.
fn edit_enc(c: &mut SavedConnection, mut f: impl FnMut(&str, &str) -> Option<String>) -> bool {
    let Ok(serde_json::Value::Object(mut map)) = serde_json::to_value(&*c) else { return false };
    let mut changed = false;
    for (k, v) in map.iter_mut().filter(|(k, _)| k.ends_with("Enc")) {
        if let Some(new) = v.as_str().filter(|s| !s.is_empty()).and_then(|s| f(k, s)) {
            *v = serde_json::Value::String(new);
            changed = true;
        }
    }
    if changed {
        if let Ok(n) = serde_json::from_value(serde_json::Value::Object(map)) {
            *c = n;
            return true;
        }
    }
    false
}

/// Unwraps sealed fields after loading. With `use_vault` false (a credential store is present) or
/// a locked/mismatched vault, sealed fields are blanked and held instead of opened.
pub fn open_list(list: &mut [SavedConnection], session: &VaultSession, use_vault: bool) -> Held {
    let mut held = Held::new();
    for c in list.iter_mut() {
        let id = c.id;
        edit_enc(c, |field, value| {
            if !vault::is_sealed(value) {
                return None;
            }
            let opened = if use_vault { session.with(|v| v.open(value)) } else { None };
            match opened {
                Some(Ok(plain)) => Some(plain),
                other => {
                    if matches!(other, Some(Err(_))) {
                        tracing::warn!(connection = id, field, "sealed secret could not be opened and was left as is");
                    }
                    held.entry(id).or_default().push((field.to_string(), value.to_string()));
                    Some(String::new())
                }
            }
        });
    }
    held
}

/// Seals one value, logging only the field name when it fails.
fn seal_value(v: &Vault, field: &str, value: &str) -> Option<String> {
    match v.seal(value) {
        Ok(sealed) => Some(sealed),
        Err(_) => {
            tracing::warn!(field, "could not seal a secret field");
            None
        }
    }
}

/// The non-empty `*Enc` fields of a connection as `(json field, value)`.
fn enc_fields(c: &SavedConnection) -> Vec<(String, String)> {
    match serde_json::to_value(c) {
        Ok(serde_json::Value::Object(m)) => m
            .into_iter()
            .filter_map(|(k, v)| match v {
                serde_json::Value::String(s) if k.ends_with("Enc") && !s.is_empty() => Some((k, s)),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Prepares the file image before saving: puts held sealed values back where the field is still
/// blank, and (when `use_vault`, i.e. there is no credential store) seals every plain value.
///
/// A secret must never reach the file protected only by obfuscation. So when the vault cannot seal
/// (locked, not set up, or a seal failure) a plain value that is new or changed compared with
/// `before` makes the whole save fail with `AppError::Vault("vault_locked" | "vault_uninitialized"
/// | "vault_seal_failed")`. Plain values that merely stay as they were (legacy files, before a
/// vault exists) pass through untouched.
pub fn seal_list(
    file: &mut [SavedConnection],
    before: &[SavedConnection],
    held: &Held,
    ctx: &VaultCtx,
    use_vault: bool,
) -> Result<(), AppError> {
    for c in file.iter_mut() {
        let id = c.id;
        if use_vault {
            let prev = before.iter().find(|b| b.id == id).map(enc_fields).unwrap_or_default();
            let unlocked = ctx.session.is_unlocked();
            let mut refusal: Option<&'static str> = None;
            edit_enc(c, |field, value| {
                if vault::is_sealed(value) {
                    return None;
                }
                if !unlocked {
                    if !prev.iter().any(|(k, v)| k == field && v == value) {
                        refusal = Some(match vault::read_file(&ctx.path) {
                            Ok(None) => "vault_uninitialized",
                            _ => "vault_locked",
                        });
                    }
                    return None;
                }
                match ctx.session.with(|v| seal_value(v, field, value)).flatten() {
                    Some(sealed) => Some(sealed),
                    None => {
                        refusal = Some("vault_seal_failed");
                        None
                    }
                }
            });
            if let Some(code) = refusal {
                return Err(AppError::Vault(code.into()));
            }
        }
        if let Some(fields) = held.get(&id) {
            restore(c, fields);
        }
    }
    Ok(())
}

/// Puts held sealed values back into fields that are blank.
fn restore(c: &mut SavedConnection, fields: &[(String, String)]) {
    let Ok(serde_json::Value::Object(mut map)) = serde_json::to_value(&*c) else { return };
    let mut changed = false;
    for (k, original) in fields {
        if map.get(k).and_then(|v| v.as_str()).is_some_and(str::is_empty) {
            map.insert(k.clone(), serde_json::Value::String(original.clone()));
            changed = true;
        }
    }
    if changed {
        if let Ok(n) = serde_json::from_value(serde_json::Value::Object(map)) {
            *c = n;
        }
    }
}

/// `"not_needed"` (a credential store exists), `"uninitialized"` (no vault yet), `"locked"` or `"unlocked"`.
pub fn vault_status(store: &dyn SecretStore, ctx: &VaultCtx) -> &'static str {
    if store.available() {
        return "not_needed";
    }
    match vault::read_file(&ctx.path) {
        Ok(None) => "uninitialized",
        _ if ctx.session.is_unlocked() => "unlocked",
        _ => "locked",
    }
}

/// Seals every plain `*Enc` value in the registry file (the one-time migration of a fallback file).
/// Nothing is written unless every value sealed.
fn seal_registry_file(registry_path: &Path, v: &Vault) -> Result<(), AppError> {
    let mut list = registry::load(registry_path)?;
    let mut changed = false;
    let mut failed = false;
    for c in list.iter_mut() {
        changed |= edit_enc(c, |field, value| {
            if vault::is_sealed(value) {
                return None;
            }
            let sealed = seal_value(v, field, value);
            failed |= sealed.is_none();
            sealed
        });
    }
    if failed {
        return Err(AppError::Vault("vault_seal_failed".into()));
    }
    if changed {
        registry::save(registry_path, &list)?;
    }
    Ok(())
}

/// Shortest master password `vault_setup` accepts (characters).
pub const MIN_PASSWORD_CHARS: usize = 8;

/// Creates the vault for `password`, unlocks it and seals what the file already holds. The session
/// is unlocked only when all of that succeeded; on failure nothing is left behind.
pub fn vault_setup(ctx: &VaultCtx, registry_path: &Path, password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(AppError::Vault("master password is too short".into()));
    }
    if vault::read_file(&ctx.path)?.is_some() {
        return Err(AppError::Vault("a master password is already set".into()));
    }
    let (v, file) = Vault::create(password)?;
    vault::write_file(&ctx.path, &file)?;
    if let Err(e) = seal_registry_file(registry_path, &v) {
        // Sealing writes the registry atomically and only at the end, so it is still unsealed here.
        let _ = std::fs::remove_file(&ctx.path);
        return Err(e);
    }
    ctx.session.set(v);
    Ok(())
}

/// Unlocks with `password` (wrong password: `Err`, nothing changes) and seals leftover plain
/// values. The session is unlocked only if sealing succeeded, so the UI and backend agree.
pub fn vault_unlock(ctx: &VaultCtx, registry_path: &Path, password: &str) -> Result<(), AppError> {
    let file = vault::read_file(&ctx.path)?.ok_or_else(|| AppError::Vault("no master password is set".into()))?;
    let v = Vault::unlock(password, &file).inspect_err(|_| tracing::warn!("vault unlock failed"))?;
    seal_registry_file(registry_path, &v)?;
    ctx.session.set(v);
    Ok(())
}

/// "Forgot master password": drops the vault and blanks every sealed field. Connections stay; there
/// is no way back to the sealed values.
pub fn vault_reset(ctx: &VaultCtx, registry_path: &Path) -> Result<(), AppError> {
    // The sealed OIDC refresh tokens are unreadable without the vault: drop them first. A failure
    // here is logged, never allowed to leave the reset half done.
    match std::fs::remove_file(tokens_path(ctx)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!(error = %e, "vault reset: could not delete oidc_tokens.json"),
    }
    let mut list = registry::load(registry_path)?;
    let mut cleared = false;
    for c in list.iter_mut() {
        cleared |= edit_enc(c, |_, value| vault::is_sealed(value).then(String::new));
    }
    if cleared {
        registry::save(registry_path, &list)?;
    }
    match std::fs::remove_file(&ctx.path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(AppError::Io(e.to_string())),
    }
    ctx.session.clear();
    tracing::warn!("vault reset: sealed secrets were discarded");
    Ok(())
}

// ---- OIDC refresh tokens -------------------------------------------------------------------------

/// Where a refresh token ended up.
#[derive(Debug, PartialEq)]
pub enum TokenOutcome {
    Keychain,
    Vault,
    /// Not written anywhere (the caller keeps it in memory for this run). The reason never contains the token.
    NotPersisted(&'static str),
}

fn tokens_path(ctx: &VaultCtx) -> PathBuf {
    ctx.path.with_file_name("oidc_tokens.json")
}

/// `connection id -> vault-sealed refresh token`. A missing or unreadable file is an empty map.
fn read_tokens(ctx: &VaultCtx) -> std::collections::BTreeMap<String, String> {
    std::fs::read_to_string(tokens_path(ctx)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write_tokens(ctx: &VaultCtx, map: &std::collections::BTreeMap<String, String>) -> Result<(), AppError> {
    if map.is_empty() {
        return match std::fs::remove_file(tokens_path(ctx)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::Io(e.to_string())),
            _ => Ok(()),
        };
    }
    let s = serde_json::to_string_pretty(map).map_err(|e| AppError::Serialize(e.to_string()))?;
    registry::write_atomic(&tokens_path(ctx), s.as_bytes())
}

/// The stored refresh token of connection `id`: from the credential store, or (without one) opened
/// from the vault when it is unlocked. `None` when absent or unreadable.
pub fn oidc_token_load(store: &dyn TokenStore, ctx: &VaultCtx, id: u32) -> Option<String> {
    if store.available() {
        return store.token_get(id).ok().flatten();
    }
    let sealed = read_tokens(ctx).remove(&id.to_string())?;
    ctx.session.with(|v| v.open(&sealed).ok()).flatten()
}

/// Persists a refresh token: in the credential store, or sealed by the vault when there is no store.
/// A locked or uninitialized vault means it is NOT persisted (never written in the clear).
pub fn oidc_token_save(store: &dyn TokenStore, ctx: &VaultCtx, id: u32, token: &str) -> TokenOutcome {
    if store.available() {
        return match store.token_set(id, token) {
            Ok(()) => TokenOutcome::Keychain,
            Err(_) => TokenOutcome::NotPersisted("the credential store refused the write"),
        };
    }
    if !ctx.session.is_unlocked() {
        return TokenOutcome::NotPersisted(match vault::read_file(&ctx.path) {
            Ok(None) => "no master password is set up",
            _ => "the vault is locked",
        });
    }
    let Some(Ok(sealed)) = ctx.session.with(|v| v.seal(token)) else {
        return TokenOutcome::NotPersisted("the token could not be sealed");
    };
    let mut map = read_tokens(ctx);
    map.insert(id.to_string(), sealed);
    match write_tokens(ctx, &map) {
        Ok(()) => TokenOutcome::Vault,
        Err(_) => TokenOutcome::NotPersisted("the token file could not be written"),
    }
}

/// Drops the stored refresh token of connection `id` (sign-out, or the connection was deleted). Needs no unlocked vault.
pub fn oidc_token_forget(store: &dyn TokenStore, ctx: &VaultCtx, id: u32) {
    if store.available() {
        let _ = store.token_delete(id);
        return;
    }
    let mut map = read_tokens(ctx);
    if map.remove(&id.to_string()).is_some() {
        let _ = write_tokens(ctx, &map);
    }
}

#[cfg(test)]
pub mod memory {
    use super::SecretStore;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// In-memory store for tests; `broken` makes every call fail like a locked keychain.
    #[derive(Default)]
    pub struct MemoryStore {
        pub items: RefCell<HashMap<u32, String>>,
        pub broken: bool,
        pub writes: RefCell<u32>,
        pub tokens: RefCell<HashMap<u32, String>>,
    }

    impl super::TokenStore for MemoryStore {
        fn token_get(&self, id: u32) -> Result<Option<String>, String> {
            if self.broken {
                return Err("locked".into());
            }
            Ok(self.tokens.borrow().get(&id).cloned())
        }
        fn token_set(&self, id: u32, value: &str) -> Result<(), String> {
            if self.broken {
                return Err("locked".into());
            }
            self.tokens.borrow_mut().insert(id, value.to_string());
            Ok(())
        }
        fn token_delete(&self, id: u32) -> Result<(), String> {
            self.tokens.borrow_mut().remove(&id);
            Ok(())
        }
    }

    impl SecretStore for MemoryStore {
        fn available(&self) -> bool {
            !self.broken
        }
        fn get(&self, id: u32) -> Result<Option<String>, String> {
            if self.broken {
                return Err("locked".into());
            }
            Ok(self.items.borrow().get(&id).cloned())
        }
        fn set(&self, id: u32, value: &str) -> Result<(), String> {
            if self.broken {
                return Err("locked".into());
            }
            *self.writes.borrow_mut() += 1;
            self.items.borrow_mut().insert(id, value.to_string());
            Ok(())
        }
        fn delete(&self, id: u32) -> Result<(), String> {
            if self.broken {
                return Err("locked".into());
            }
            self.items.borrow_mut().remove(&id);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::memory::MemoryStore;
    use super::*;
    use crate::registry::tests::conn;

    fn with_pw(id: u32, pw: &str) -> SavedConnection {
        let mut c = conn(id);
        c.password_enc = pw.into();
        c
    }

    #[test]
    fn saving_moves_secrets_out_of_the_file() {
        let store = MemoryStore::default();
        let after = vec![with_pw(1, "enc-pw"), conn(2)];
        let file = sync(&[], &after, &Locked::new(), &store);
        assert!(file[0].secrets_in_keychain);
        assert_eq!(file[0].password_enc, "");
        assert!(!file[1].secrets_in_keychain); // nothing secret, nothing stored
        assert!(store.items.borrow()[&1].contains("enc-pw"));
        assert!(!store.items.borrow().contains_key(&2));
    }

    #[test]
    fn proxy_password_and_aws_token_go_to_the_store_and_come_back() {
        let store = MemoryStore::default();
        let mut c = conn(1);
        c.proxy_password_enc = "enc-proxy".into();
        c.aws_session_token_enc = "enc-token".into();
        let file = sync(&[], &[c], &Locked::new(), &store);
        assert_eq!((file[0].proxy_password_enc.as_str(), file[0].aws_session_token_enc.as_str()), ("", ""));
        assert!(file[0].secrets_in_keychain);
        let mut loaded = file;
        fill(&mut loaded, &store);
        assert_eq!((loaded[0].proxy_password_enc.as_str(), loaded[0].aws_session_token_enc.as_str()), ("enc-proxy", "enc-token"));
    }

    #[test]
    fn loading_fills_secrets_back() {
        let store = MemoryStore::default();
        let mut list = sync(&[], &[with_pw(1, "enc-pw")], &Locked::new(), &store);
        let locked = fill(&mut list, &store);
        assert!(locked.is_empty());
        assert_eq!(list[0].password_enc, "enc-pw");
        assert!(list[0].secrets_in_keychain);
    }

    #[test]
    fn unchanged_secrets_are_not_rewritten() {
        let store = MemoryStore::default();
        let mut loaded = sync(&[], &[with_pw(1, "a")], &Locked::new(), &store);
        let locked = fill(&mut loaded, &store);
        let mut touched = loaded.clone();
        touched[0].last_connected_at = Some(5);
        sync(&loaded, &touched, &locked, &store);
        assert_eq!(*store.writes.borrow(), 1);
    }

    #[test]
    fn changing_clearing_and_deleting_update_the_store() {
        let store = MemoryStore::default();
        let mut loaded = sync(&[], &[with_pw(1, "a"), with_pw(2, "b")], &Locked::new(), &store);
        fill(&mut loaded, &store);

        let mut changed = loaded.clone();
        changed[0].password_enc = "a2".into();
        changed[1].password_enc = String::new();
        let file = sync(&loaded, &changed, &Locked::new(), &store);
        assert!(store.items.borrow()[&1].contains("a2"));
        assert!(!store.items.borrow().contains_key(&2));
        assert!(!file[1].secrets_in_keychain);

        let mut reloaded = file.clone();
        fill(&mut reloaded, &store);
        let removed: Vec<_> = reloaded.iter().filter(|c| c.id != 1).cloned().collect();
        sync(&reloaded, &removed, &Locked::new(), &store);
        assert!(store.items.borrow().is_empty());
    }

    #[test]
    fn unavailable_store_keeps_secrets_in_the_file() {
        let store = MemoryStore { broken: true, ..Default::default() };
        let file = sync(&[], &[with_pw(1, "enc-pw")], &Locked::new(), &store);
        assert!(!file[0].secrets_in_keychain);
        assert_eq!(file[0].password_enc, "enc-pw");
        assert!(!needs_migration(&file, &store));
    }

    #[test]
    fn a_locked_credential_survives_an_unrelated_save() {
        let good = MemoryStore::default();
        let stored = sync(&[], &[with_pw(1, "a")], &Locked::new(), &good);
        // Next launch the store can't be read: the connection loads without its secret…
        let locked_store = MemoryStore { broken: true, ..Default::default() };
        let mut loaded = stored.clone();
        let locked = fill(&mut loaded, &locked_store);
        assert!(locked.contains(&1));
        assert_eq!(loaded[0].password_enc, "");
        // …and saving (e.g. a touch) must not drop the flag or the credential.
        let file = sync(&loaded, &loaded, &locked, &locked_store);
        assert!(file[0].secrets_in_keychain);
    }

    #[test]
    fn missing_credential_drops_the_flag() {
        let store = MemoryStore::default();
        let mut list = vec![conn(1)];
        list[0].secrets_in_keychain = true;
        fill(&mut list, &store);
        assert!(!list[0].secrets_in_keychain);
    }

    #[test]
    fn migration_is_needed_only_for_file_secrets_with_a_store() {
        let store = MemoryStore::default();
        assert!(needs_migration(&[with_pw(1, "x")], &store));
        assert!(!needs_migration(&[conn(1)], &store));
        let migrated = sync(&[with_pw(1, "x")], &[with_pw(1, "x")], &Locked::new(), &store);
        assert!(!needs_migration(&migrated, &store));
        assert_eq!(migrated[0].password_enc, "");
    }

    /// Against the real platform store: `cargo test os_keychain -- --ignored` (on Linux, inside a
    /// D-Bus session with an unlocked Secret Service such as gnome-keyring).
    #[test]
    #[ignore]
    fn os_keychain_roundtrip() {
        let store = OsKeychain;
        assert!(store.available(), "no credential store");
        let id = 4_000_000_000;
        store.delete(id).unwrap();
        assert_eq!(store.get(id).unwrap(), None);
        store.set(id, "{\"passwordEnc\":\"x\"}").unwrap();
        assert_eq!(store.get(id).unwrap().as_deref(), Some("{\"passwordEnc\":\"x\"}"));
        store.set(id, "second").unwrap();
        assert_eq!(store.get(id).unwrap().as_deref(), Some("second"));
        store.delete(id).unwrap();
        store.delete(id).unwrap(); // deleting twice is fine
        assert_eq!(store.get(id).unwrap(), None);
    }

    fn token_ctx<'a>(name: &str, session: &'a VaultSession) -> VaultCtx<'a> {
        let dir = std::env::temp_dir().join(format!("lumiong_oidc_tokens_{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        VaultCtx { path: dir.join("vault.json"), session }
    }

    #[test]
    fn oidc_refresh_token_lives_in_the_keychain_under_its_own_account() {
        let store = MemoryStore::default();
        let session = VaultSession::default();
        let ctx = token_ctx("keychain", &session);
        assert_eq!(oidc_token_load(&store, &ctx, 7), None);
        assert_eq!(oidc_token_save(&store, &ctx, 7, "rt-1"), TokenOutcome::Keychain);
        assert_eq!(oidc_token_load(&store, &ctx, 7).as_deref(), Some("rt-1"));
        // The connection secrets credential is a different account: untouched.
        assert!(store.items.borrow().is_empty());
        oidc_token_forget(&store, &ctx, 7);
        assert_eq!(oidc_token_load(&store, &ctx, 7), None);
        assert_eq!(token_account(7), "oidc-refresh-7");
    }

    #[test]
    fn oidc_refresh_token_is_sealed_by_an_unlocked_vault_when_there_is_no_keychain() {
        let store = MemoryStore { broken: true, ..Default::default() };
        let session = VaultSession::default();
        let ctx = token_ctx("sealed", &session);
        let (vault, _) = Vault::create("correct horse").unwrap();
        session.set(vault);
        assert_eq!(oidc_token_save(&store, &ctx, 3, "rt-secret"), TokenOutcome::Vault);
        let on_disk = std::fs::read_to_string(tokens_path(&ctx)).unwrap();
        assert!(!on_disk.contains("rt-secret") && on_disk.contains("vault:v1:"), "{on_disk}");
        assert_eq!(oidc_token_load(&store, &ctx, 3).as_deref(), Some("rt-secret"));
        // Locked again: unreadable, but it can still be forgotten.
        session.clear();
        assert_eq!(oidc_token_load(&store, &ctx, 3), None);
        oidc_token_forget(&store, &ctx, 3);
        assert!(!tokens_path(&ctx).exists());
    }

    #[test]
    fn oidc_refresh_token_is_not_persisted_with_a_locked_or_missing_vault() {
        let store = MemoryStore { broken: true, ..Default::default() };
        let session = VaultSession::default();
        let ctx = token_ctx("locked", &session);
        assert_eq!(oidc_token_save(&store, &ctx, 1, "rt"), TokenOutcome::NotPersisted("no master password is set up"));
        let (vault, file) = Vault::create("pw-123456").unwrap();
        vault::write_file(&ctx.path, &file).unwrap();
        drop(vault);
        assert_eq!(oidc_token_save(&store, &ctx, 1, "rt"), TokenOutcome::NotPersisted("the vault is locked"));
        assert!(!tokens_path(&ctx).exists());
    }

    #[test]
    fn vault_reset_also_deletes_the_sealed_oidc_tokens() {
        let store = MemoryStore { broken: true, ..Default::default() };
        let session = VaultSession::default();
        let ctx = token_ctx("reset", &session);
        let (vault, file) = Vault::create("pw-123456").unwrap();
        vault::write_file(&ctx.path, &file).unwrap();
        session.set(vault);
        assert_eq!(oidc_token_save(&store, &ctx, 2, "rt"), TokenOutcome::Vault);
        assert!(tokens_path(&ctx).exists());
        let reg = ctx.path.with_file_name("connections.json");
        vault_reset(&ctx, &reg).unwrap();
        assert!(!tokens_path(&ctx).exists() && !ctx.path.exists());
    }
}

