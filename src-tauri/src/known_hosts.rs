use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A trusted SSH host key, keyed by `(host, port)` — mirrors OpenSSH's `known_hosts` semantics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
}

/// Result of checking a server's presented key against the trust store.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// No entry for this `(host, port)` yet — trust it and record it (TOFU).
    FirstUse,
    /// Matches the previously trusted key.
    Match,
    /// A different key is on file — possible host reinstall, possible MITM.
    Mismatch { previous_key_type: String, previous_fingerprint: String },
}

pub fn verify(list: &[KnownHost], host: &str, port: u16, key_type: &str, fingerprint: &str) -> Verdict {
    match list.iter().find(|h| h.host == host && h.port == port) {
        None => Verdict::FirstUse,
        Some(h) if h.key_type == key_type && h.fingerprint == fingerprint => Verdict::Match,
        Some(h) => Verdict::Mismatch {
            previous_key_type: h.key_type.clone(),
            previous_fingerprint: h.fingerprint.clone(),
        },
    }
}

/// Insert or overwrite the entry for `(host, port)`.
pub fn upsert(mut list: Vec<KnownHost>, host: &str, port: u16, key_type: &str, fingerprint: &str) -> Vec<KnownHost> {
    list.retain(|h| !(h.host == host && h.port == port));
    list.push(KnownHost {
        host: host.to_string(),
        port,
        key_type: key_type.to_string(),
        fingerprint: fingerprint.to_string(),
    });
    list
}

/// Drop the trusted entry for `(host, port)`, if any — the next connect will treat it as first use.
pub fn forget(list: Vec<KnownHost>, host: &str, port: u16) -> Vec<KnownHost> {
    list.into_iter().filter(|h| !(h.host == host && h.port == port)).collect()
}

/// Missing file → Ok(vec![]); malformed JSON → Parse error; other read errors → Io error.
pub fn load(path: &Path) -> Result<Vec<KnownHost>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn save(path: &Path, list: &[KnownHost]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(list).map_err(|e| AppError::Serialize(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(host: &str, port: u16, key_type: &str, fingerprint: &str) -> KnownHost {
        KnownHost {
            host: host.to_string(),
            port,
            key_type: key_type.to_string(),
            fingerprint: fingerprint.to_string(),
        }
    }

    #[test]
    fn verify_unknown_host_is_first_use() {
        let list = vec![];
        assert_eq!(verify(&list, "h", 22, "ssh-ed25519", "AAA"), Verdict::FirstUse);
    }

    #[test]
    fn verify_matching_key_is_match() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        assert_eq!(verify(&list, "h", 22, "ssh-ed25519", "AAA"), Verdict::Match);
    }

    #[test]
    fn verify_different_fingerprint_is_mismatch() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        assert_eq!(
            verify(&list, "h", 22, "ssh-ed25519", "BBB"),
            Verdict::Mismatch { previous_key_type: "ssh-ed25519".into(), previous_fingerprint: "AAA".into() }
        );
    }

    #[test]
    fn verify_different_key_type_same_fingerprint_string_is_mismatch() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        assert_eq!(
            verify(&list, "h", 22, "ssh-rsa", "AAA"),
            Verdict::Mismatch { previous_key_type: "ssh-ed25519".into(), previous_fingerprint: "AAA".into() }
        );
    }

    #[test]
    fn verify_is_scoped_to_host_and_port() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        assert_eq!(verify(&list, "h", 2222, "ssh-ed25519", "AAA"), Verdict::FirstUse);
        assert_eq!(verify(&list, "other", 22, "ssh-ed25519", "AAA"), Verdict::FirstUse);
    }

    #[test]
    fn upsert_adds_new_entry() {
        let list = upsert(vec![], "h", 22, "ssh-ed25519", "AAA");
        assert_eq!(list, vec![host("h", 22, "ssh-ed25519", "AAA")]);
    }

    #[test]
    fn upsert_replaces_existing_entry_for_same_host_and_port() {
        let list = upsert(vec![host("h", 22, "ssh-ed25519", "AAA")], "h", 22, "ssh-ed25519", "BBB");
        assert_eq!(list, vec![host("h", 22, "ssh-ed25519", "BBB")]);
    }

    #[test]
    fn forget_drops_matching_entry_only() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA"), host("other", 22, "ssh-ed25519", "CCC")];
        let out = forget(list, "h", 22);
        assert_eq!(out, vec![host("other", 22, "ssh-ed25519", "CCC")]);
    }

    #[test]
    fn forget_unknown_host_is_noop() {
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        assert_eq!(forget(list.clone(), "nope", 22), list);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("monglumio_test_known_hosts_roundtrip");
        let path = dir.join("known_hosts.json");
        let _ = std::fs::remove_dir_all(&dir);
        let list = vec![host("h", 22, "ssh-ed25519", "AAA")];
        save(&path, &list).unwrap();
        assert_eq!(load(&path).unwrap(), list);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_empty() {
        let path = std::env::temp_dir().join("monglumio_test_known_hosts_missing/nope.json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert_eq!(load(&path).unwrap(), Vec::<KnownHost>::new());
    }
}
