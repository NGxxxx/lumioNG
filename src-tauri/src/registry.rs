use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Profile fields supplied by the frontend on save (no id); `password_enc` is already obfuscated by the frontend `domain/secret` transform — never plaintext.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub label: String,
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub auth_method: String,
    pub user: String,
    pub password_enc: String,
    pub auth_source: String,
    pub replica_set: String,
    pub tls: bool,
    pub extra_options: String,
    pub read_only: bool,
    pub tls_certificate_key_file: String,
    pub tls_certificate_key_file_password_enc: String,
    pub ssh_enabled: bool,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: String,
    pub ssh_auth_method: String,
    pub ssh_password_enc: String,
    pub ssh_private_key_path: String,
    pub ssh_passphrase_enc: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub id: u32,
    pub label: String,
    #[serde(default)]
    pub scheme: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub auth_method: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password_enc: String,
    #[serde(default)]
    pub auth_source: String,
    #[serde(default)]
    pub replica_set: String,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub extra_options: String,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub tls_certificate_key_file: String,
    #[serde(default)]
    pub tls_certificate_key_file_password_enc: String,
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: String,
    #[serde(default)]
    pub ssh_port: u16,
    #[serde(default)]
    pub ssh_user: String,
    #[serde(default)]
    pub ssh_auth_method: String,
    #[serde(default)]
    pub ssh_password_enc: String,
    #[serde(default)]
    pub ssh_private_key_path: String,
    #[serde(default)]
    pub ssh_passphrase_enc: String,
    /// Legacy pre-Phase-E field; present only in un-migrated files. Cleared on next save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// Epoch millis of the last successful connect; `None` if never connected.
    #[serde(default)]
    pub last_connected_at: Option<i64>,
}

impl SavedConnection {
    fn from_input(id: u32, input: ConnectionInput) -> Self {
        SavedConnection {
            id,
            label: input.label,
            scheme: input.scheme,
            host: input.host,
            port: input.port,
            auth_method: input.auth_method,
            user: input.user,
            password_enc: input.password_enc,
            auth_source: input.auth_source,
            replica_set: input.replica_set,
            tls: input.tls,
            extra_options: input.extra_options,
            read_only: input.read_only,
            tls_certificate_key_file: input.tls_certificate_key_file,
            tls_certificate_key_file_password_enc: input.tls_certificate_key_file_password_enc,
            ssh_enabled: input.ssh_enabled,
            ssh_host: input.ssh_host,
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user,
            ssh_auth_method: input.ssh_auth_method,
            ssh_password_enc: input.ssh_password_enc,
            ssh_private_key_path: input.ssh_private_key_path,
            ssh_passphrase_enc: input.ssh_passphrase_enc,
            uri: None,
            last_connected_at: None,
        }
    }
}

/// `id` None → append; `id` matching → overwrite profile fields and clear legacy `uri`; `id` not matching → list unchanged.
pub fn upsert(
    mut list: Vec<SavedConnection>,
    id: Option<u32>,
    input: ConnectionInput,
) -> Vec<SavedConnection> {
    match id {
        Some(id) => {
            if let Some(c) = list.iter_mut().find(|c| c.id == id) {
                let last_connected_at = c.last_connected_at;
                *c = SavedConnection::from_input(id, input);
                c.last_connected_at = last_connected_at;
            }
            list
        }
        None => {
            let next = list.iter().map(|c| c.id).max().map_or(1, |m| m + 1);
            list.push(SavedConnection::from_input(next, input));
            list
        }
    }
}

pub fn remove(list: Vec<SavedConnection>, id: u32) -> Vec<SavedConnection> {
    list.into_iter().filter(|c| c.id != id).collect()
}

/// Stamp `id`'s `last_connected_at` with `now_ms`. Unknown `id` is a no-op (mirrors `upsert`).
pub fn touch(mut list: Vec<SavedConnection>, id: u32, now_ms: i64) -> Vec<SavedConnection> {
    if let Some(c) = list.iter_mut().find(|c| c.id == id) {
        c.last_connected_at = Some(now_ms);
    }
    list
}

/// Missing file → Ok(vec![]); malformed JSON → Parse error; other read errors → Io error.
pub fn load(path: &Path) -> Result<Vec<SavedConnection>, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn save(path: &Path, list: &[SavedConnection]) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(list).map_err(|e| AppError::Serialize(e.to_string()))?;
    std::fs::write(path, s).map_err(|e| AppError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(label: &str, host: &str) -> ConnectionInput {
        ConnectionInput {
            label: label.into(),
            scheme: "mongodb".into(),
            host: host.into(),
            port: Some(27017),
            auth_method: "none".into(),
            user: String::new(),
            password_enc: String::new(),
            auth_source: String::new(),
            replica_set: String::new(),
            tls: false,
            extra_options: String::new(),
            read_only: false,
            tls_certificate_key_file: String::new(),
            tls_certificate_key_file_password_enc: String::new(),
            ssh_enabled: false,
            ssh_host: String::new(),
            ssh_port: 22,
            ssh_user: String::new(),
            ssh_auth_method: String::new(),
            ssh_password_enc: String::new(),
            ssh_private_key_path: String::new(),
            ssh_passphrase_enc: String::new(),
        }
    }

    #[test]
    fn upsert_new_on_empty_gets_id_1() {
        let out = upsert(vec![], None, input("Local", "localhost"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, 1);
        assert_eq!(out[0].host, "localhost");
        assert_eq!(out[0].uri, None);
    }

    #[test]
    fn upsert_new_gets_max_id_plus_1() {
        let mut list = upsert(vec![], None, input("a", "ha")); // id 1
        // force a gap: make the second entry id 4
        let mut second = upsert(vec![], None, input("b", "hb"));
        second[0].id = 4;
        list.append(&mut second);
        let out = upsert(list, None, input("c", "hc"));
        assert_eq!(out.last().unwrap().id, 5);
    }

    #[test]
    fn upsert_existing_updates_keeps_id_and_clears_legacy_uri() {
        let mut list = upsert(vec![], None, input("old", "oldhost"));
        list[0].uri = Some("mongodb://legacy".into());
        let out = upsert(list, Some(1), input("new", "newhost"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, 1);
        assert_eq!(out[0].label, "new");
        assert_eq!(out[0].host, "newhost");
        assert_eq!(out[0].uri, None);
    }

    #[test]
    fn upsert_unknown_id_is_noop() {
        let list = upsert(vec![], None, input("a", "ha"));
        let out = upsert(list.clone(), Some(99), input("x", "hx"));
        assert_eq!(out, list);
    }

    #[test]
    fn remove_drops_matching_id() {
        let list = upsert(vec![], None, input("a", "ha"));
        assert!(remove(list, 1).is_empty());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_roundtrip");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        let list = upsert(vec![], None, input("Local", "localhost"));
        save(&path, &list).unwrap();
        assert_eq!(load(&path).unwrap(), list);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_empty() {
        let path = std::env::temp_dir().join("monglumio_test_registry_missing/nope.json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert_eq!(load(&path).unwrap(), Vec::<SavedConnection>::new());
    }

    #[test]
    fn legacy_file_deserializes_with_uri_and_empty_fields() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_legacy");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","uri":"mongodb://localhost:27017"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].uri.as_deref(), Some("mongodb://localhost:27017"));
        assert_eq!(list[0].host, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn from_input_carries_read_only() {
        let mut i = input("RO", "localhost");
        i.read_only = true;
        let out = upsert(vec![], None, i);
        assert!(out[0].read_only);
    }

    #[test]
    fn legacy_file_defaults_read_only_false() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_ro_default");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert!(!list[0].read_only);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn touch_stamps_last_connected_at() {
        let list = upsert(vec![], None, input("a", "ha"));
        let out = touch(list, 1, 12345);
        assert_eq!(out[0].last_connected_at, Some(12345));
    }

    #[test]
    fn touch_unknown_id_is_noop() {
        let list = upsert(vec![], None, input("a", "ha"));
        let out = touch(list.clone(), 99, 12345);
        assert_eq!(out, list);
    }

    #[test]
    fn upsert_existing_preserves_last_connected_at() {
        let list = touch(upsert(vec![], None, input("old", "oldhost")), 1, 999);
        let out = upsert(list, Some(1), input("new", "newhost"));
        assert_eq!(out[0].last_connected_at, Some(999));
    }

    #[test]
    fn legacy_file_defaults_last_connected_at_none() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_last_connected_default");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert_eq!(list[0].last_connected_at, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ssh_and_x509_fields_round_trip_through_save_and_load() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_ssh_fields");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut i = input("SSH", "internal-host");
        i.tls_certificate_key_file = "/certs/client.pem".into();
        i.tls_certificate_key_file_password_enc = "encpw".into();
        i.ssh_enabled = true;
        i.ssh_host = "bastion.example.com".into();
        i.ssh_port = 22;
        i.ssh_user = "deploy".into();
        i.ssh_auth_method = "key".into();
        i.ssh_private_key_path = "/home/me/.ssh/id_ed25519".into();
        i.ssh_passphrase_enc = "encpass".into();
        let list = upsert(vec![], None, i);
        save(&path, &list).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded[0].ssh_enabled, true);
        assert_eq!(loaded[0].ssh_host, "bastion.example.com");
        assert_eq!(loaded[0].ssh_private_key_path, "/home/me/.ssh/id_ed25519");
        assert_eq!(loaded[0].tls_certificate_key_file, "/certs/client.pem");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_file_without_ssh_fields_defaults_them_empty() {
        let dir = std::env::temp_dir().join("monglumio_test_registry_ssh_legacy_default");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert_eq!(list[0].ssh_enabled, false);
        assert_eq!(list[0].ssh_host, "");
        assert_eq!(list[0].tls_certificate_key_file, "");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
