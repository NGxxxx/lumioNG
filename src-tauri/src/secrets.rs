//! Keeps saved-connection secrets (passwords, passphrases) in the OS credential store instead of
//! `connections.json`: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux.
//!
//! One credential per connection (service `LumioNG`, account `connection-<id>`) holding the four
//! secret fields as JSON. The values are the frontend's obfuscated `*Enc` strings, so the IPC
//! contract is unchanged: the frontend still sends and receives them exactly as before. When no
//! credential store is available (e.g. a Linux session without a Secret Service), secrets stay in
//! the file as they always did.

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
    if FAILED.load(Ordering::Relaxed) {
        return Err("credential store unavailable".into());
    }
    let result = keyring::Entry::new(SERVICE, &account(id)).and_then(|e| call(&e));
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

/// The four secret fields of a connection, as stored in one credential.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Secrets {
    pub password_enc: String,
    pub tls_certificate_key_file_password_enc: String,
    pub ssh_password_enc: String,
    pub ssh_passphrase_enc: String,
}

impl Secrets {
    pub fn of(c: &SavedConnection) -> Self {
        Secrets {
            password_enc: c.password_enc.clone(),
            tls_certificate_key_file_password_enc: c.tls_certificate_key_file_password_enc.clone(),
            ssh_password_enc: c.ssh_password_enc.clone(),
            ssh_passphrase_enc: c.ssh_passphrase_enc.clone(),
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
}

