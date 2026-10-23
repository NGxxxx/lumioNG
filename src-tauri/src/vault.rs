//! Master-password vault: AES-256-GCM sealing of the saved-connection secrets when the OS has no
//! credential store (see `secrets.rs`).
//!
//! The strings it wraps are the frontend's obfuscated `*_enc` values, taken as opaque text, so the
//! IPC contract does not change. A sealed value is `vault:v1:<base64(nonce | ciphertext+tag)>`.
//! The key is `Argon2id(master password, salt)`; the salt, the cost parameters and a sealed known
//! constant (the verifier, which lets a wrong password be rejected before anything is opened) live
//! in `vault.json` next to `connections.json`. The key exists only in memory, zeroized on drop.

use crate::error::AppError;
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use zeroize::Zeroizing;

pub const PREFIX: &str = "vault:v1:";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
/// Sealed on creation and opened on unlock to tell a right password from a wrong one.
const VERIFIER_PLAIN: &str = "lumio-vault-verifier-v1";

/// Production Argon2id cost: 64 MiB, 3 passes, 1 lane.
const M_COST_KIB: u32 = 64 * 1024;
const T_COST: u32 = 3;
const P_COST: u32 = 1;
/// Upper bounds accepted from a `vault.json` on disk (a corrupted or hostile file must not make
/// unlock allocate gigabytes).
const MAX_M_COST_KIB: u32 = 1024 * 1024;
const MAX_T_COST: u32 = 16;
const MAX_P_COST: u32 = 16;

/// The costs used for a new vault. Tests use a far cheaper set so they stay fast.
fn new_vault_costs() -> KdfCosts {
    #[cfg(test)]
    {
        KdfCosts { m: 8, t: 1, p: 1 }
    }
    #[cfg(not(test))]
    {
        production_costs()
    }
}

fn production_costs() -> KdfCosts {
    KdfCosts { m: M_COST_KIB, t: T_COST, p: P_COST }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct KdfCosts {
    /// Memory in KiB.
    pub m: u32,
    pub t: u32,
    pub p: u32,
}

/// `vault.json`: everything needed to re-derive the key from the password, and nothing secret.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VaultFile {
    pub version: u32,
    pub kdf: String,
    pub costs: KdfCosts,
    /// Base64 salt.
    pub salt: String,
    /// `VERIFIER_PLAIN` sealed with the derived key.
    pub verifier: String,
}

/// An unlocked vault: the derived key, kept in memory only.
pub struct Vault {
    key: Zeroizing<[u8; KEY_LEN]>,
}

fn vault_err(msg: &str) -> AppError {
    AppError::Vault(msg.to_string())
}

fn random<const N: usize>() -> Result<[u8; N], AppError> {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).map_err(|_| vault_err("no source of randomness"))?;
    Ok(buf)
}

fn derive(password: &str, salt: &[u8], costs: KdfCosts) -> Result<Zeroizing<[u8; KEY_LEN]>, AppError> {
    let params = Params::new(costs.m, costs.t, costs.p, Some(KEY_LEN)).map_err(|_| vault_err("invalid key derivation parameters"))?;
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut_slice())
        .map_err(|_| vault_err("key derivation failed"))?;
    Ok(key)
}

/// Whether `s` is a value produced by [`Vault::seal`].
pub fn is_sealed(s: &str) -> bool {
    s.starts_with(PREFIX)
}

impl Vault {
    /// A fresh vault for `password` with a new random salt, plus the file that unlocks it later.
    pub fn create(password: &str) -> Result<(Vault, VaultFile), AppError> {
        if password.is_empty() {
            return Err(vault_err("master password is empty"));
        }
        let costs = new_vault_costs();
        let salt = random::<SALT_LEN>()?;
        let vault = Vault { key: derive(password, &salt, costs)? };
        let file = VaultFile {
            version: 1,
            kdf: "argon2id".into(),
            costs,
            salt: STANDARD.encode(salt),
            verifier: vault.seal(VERIFIER_PLAIN)?,
        };
        Ok((vault, file))
    }

    /// Derives the key from `password` and checks it against the file's verifier. A wrong password
    /// is a normal `Err`, never a panic.
    pub fn unlock(password: &str, file: &VaultFile) -> Result<Vault, AppError> {
        let c = file.costs;
        if file.version != 1 || file.kdf != "argon2id" {
            return Err(vault_err("unsupported vault file"));
        }
        if c.m > MAX_M_COST_KIB || c.t > MAX_T_COST || c.p > MAX_P_COST {
            return Err(vault_err("vault file has unreasonable key derivation parameters"));
        }
        let salt = STANDARD.decode(&file.salt).map_err(|_| vault_err("vault file is corrupted"))?;
        let vault = Vault { key: derive(password, &salt, c)? };
        match vault.open(&file.verifier) {
            Ok(v) if v == VERIFIER_PLAIN => Ok(vault),
            _ => Err(vault_err("wrong master password")),
        }
    }

    fn cipher(&self) -> Result<Aes256Gcm, AppError> {
        Aes256Gcm::new_from_slice(self.key.as_slice()).map_err(|_| vault_err("invalid key"))
    }

    /// `vault:v1:<base64(nonce | ciphertext)>` with a fresh random nonce each call.
    pub fn seal(&self, plain: &str) -> Result<String, AppError> {
        let nonce = random::<NONCE_LEN>()?;
        let ct = self
            .cipher()?
            .encrypt((&nonce).into(), plain.as_bytes())
            .map_err(|_| vault_err("encryption failed"))?;
        let mut blob = nonce.to_vec();
        blob.extend_from_slice(&ct);
        Ok(format!("{PREFIX}{}", STANDARD.encode(blob)))
    }

    /// Reverses [`seal`](Self::seal). Fails on a wrong key, a modified value or a malformed one.
    pub fn open(&self, sealed: &str) -> Result<String, AppError> {
        let b64 = sealed.strip_prefix(PREFIX).ok_or_else(|| vault_err("value is not sealed"))?;
        let blob = STANDARD.decode(b64).map_err(|_| vault_err("sealed value is corrupted"))?;
        if blob.len() < NONCE_LEN + 16 {
            return Err(vault_err("sealed value is corrupted"));
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| vault_err("sealed value is corrupted"))?;
        let plain = self
            .cipher()?
            .decrypt((&nonce).into(), ct)
            .map_err(|_| vault_err("sealed value failed authentication"))?;
        String::from_utf8(plain).map_err(|_| vault_err("sealed value is corrupted"))
    }
}

/// Reads `vault.json`; `Ok(None)` when no vault was ever set up.
pub fn read_file(path: &Path) -> Result<Option<VaultFile>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map(Some).map_err(|_| vault_err("vault file is corrupted")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn write_file(path: &Path, file: &VaultFile) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(file).map_err(|e| AppError::Serialize(e.to_string()))?;
    crate::registry::write_atomic(path, s.as_bytes())
}

/// The unlocked vault, if any, shared as Tauri managed state. Empty means locked (or not set up).
#[derive(Default)]
pub struct VaultSession(Mutex<Option<Vault>>);

impl VaultSession {
    pub fn set(&self, vault: Vault) {
        *crate::util::lock_recover(&self.0) = Some(vault);
    }
    pub fn clear(&self) {
        *crate::util::lock_recover(&self.0) = None;
    }
    pub fn is_unlocked(&self) -> bool {
        crate::util::lock_recover(&self.0).is_some()
    }
    pub fn with<T>(&self, f: impl FnOnce(&Vault) -> T) -> Option<T> {
        crate::util::lock_recover(&self.0).as_ref().map(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_parameters_match_the_brief() {
        let c = production_costs();
        assert_eq!((c.m, c.t, c.p), (64 * 1024, 3, 1));
        assert!(Params::new(c.m, c.t, c.p, Some(KEY_LEN)).is_ok());
    }

    #[test]
    fn seal_open_round_trip() {
        let (v, _) = Vault::create("hunter2").unwrap();
        for plain in ["", "enc:abc==", "ünïcode ✓", &"x".repeat(5000)] {
            let sealed = v.seal(plain).unwrap();
            assert!(is_sealed(&sealed));
            assert!(!sealed.contains(plain) || plain.is_empty());
            assert_eq!(v.open(&sealed).unwrap(), plain);
        }
        // A fresh nonce each time.
        assert_ne!(v.seal("same").unwrap(), v.seal("same").unwrap());
        assert!(!is_sealed("plain"));
    }

    #[test]
    fn wrong_password_is_rejected_without_panic() {
        let (_, file) = Vault::create("right").unwrap();
        assert!(Vault::unlock("wrong", &file).is_err());
        assert!(Vault::unlock("", &file).is_err());
        assert!(Vault::unlock("right", &file).is_ok());
        // A damaged file fails cleanly too.
        let mut bad = file.clone();
        bad.salt = "!!not base64!!".into();
        assert!(Vault::unlock("right", &bad).is_err());
        let mut bad = file.clone();
        bad.verifier = "garbage".into();
        assert!(Vault::unlock("right", &bad).is_err());
        let mut bad = file;
        bad.costs.m = u32::MAX;
        assert!(Vault::unlock("right", &bad).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let (v, _) = Vault::create("pw").unwrap();
        let sealed = v.seal("secret").unwrap();
        let mut blob = STANDARD.decode(sealed.strip_prefix(PREFIX).unwrap()).unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 1;
        assert!(v.open(&format!("{PREFIX}{}", STANDARD.encode(&blob))).is_err());
        assert!(v.open(&format!("{PREFIX}{}", STANDARD.encode(&blob[..5]))).is_err());
        assert!(v.open("vault:v1:@@@").is_err());
        assert!(v.open("no-prefix").is_err());
        // A value sealed under another key does not open either.
        let (other, _) = Vault::create("other").unwrap();
        assert!(other.open(&sealed).is_err());
    }

    #[test]
    fn unlock_derives_the_same_key_as_create() {
        let (v, file) = Vault::create("pw").unwrap();
        let sealed = v.seal("secret").unwrap();
        let again = Vault::unlock("pw", &file).unwrap();
        assert_eq!(again.open(&sealed).unwrap(), "secret");
        // The file stores no key material beyond salt and verifier.
        let json = serde_json::to_string(&file).unwrap();
        assert!(!json.contains("pw\""));
    }

    #[test]
    fn empty_password_cannot_create_a_vault() {
        assert!(Vault::create("").is_err());
    }

    #[test]
    fn vault_file_is_written_atomically_and_replaced() {
        let dir = std::env::temp_dir().join("lumio_test_vault_file_atomic");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("vault.json");
        let (_, first) = Vault::create("password-one").unwrap();
        let (_, second) = Vault::create("password-two").unwrap();
        write_file(&path, &first).unwrap();
        write_file(&path, &second).unwrap();
        assert_eq!(read_file(&path).unwrap().unwrap(), second);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1); // no stray temp file
        // A blocked temp file fails the write and leaves the previous vault intact.
        std::fs::create_dir(dir.join("vault.json.tmp")).unwrap();
        assert!(write_file(&path, &first).is_err());
        assert_eq!(read_file(&path).unwrap().unwrap(), second);
    }
}
