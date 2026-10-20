use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// How MCP clients may use a connection: "off" (hidden), "read" (default) or "write".
pub const MCP_ACCESS_READ: &str = "read";

fn default_mcp_access() -> String {
    MCP_ACCESS_READ.to_string()
}

/// A valid access level for a connection of `environment`: unknown values become "read", and a PROD
/// connection can never be "write" (the frontend enforces the same rule; this is the backstop).
pub fn clamp_mcp_access(environment: &str, access: &str) -> String {
    match access {
        "off" => "off",
        "write" if environment != "prod" => "write",
        _ => MCP_ACCESS_READ,
    }
    .to_string()
}

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
    /// "" | "dev" | "staging" | "prod" — drives badges and the PROD confirmation policy.
    #[serde(default)]
    pub environment: String,
    /// Hex session color; "" = assigned automatically.
    #[serde(default)]
    pub color: String,
    /// "off" | "read" | "write" — what MCP clients may do with this connection once open.
    #[serde(default = "default_mcp_access")]
    pub mcp_access: String,
    /// "none" | "socks5" | "http"; "" (older files) means none.
    #[serde(default)]
    pub proxy_type: String,
    #[serde(default)]
    pub proxy_host: String,
    #[serde(default)]
    pub proxy_port: Option<u16>,
    #[serde(default)]
    pub proxy_user: String,
    #[serde(default)]
    pub proxy_password_enc: String,
    /// MONGODB-AWS optional STS session token (obfuscated; a secret like the other `*Enc` fields).
    #[serde(default)]
    pub aws_session_token_enc: String,
    /// Kerberos (GSSAPI) mechanism properties; "" = driver default.
    #[serde(default)]
    pub gssapi_service_name: String,
    #[serde(default)]
    pub gssapi_service_realm: String,
    #[serde(default)]
    pub gssapi_canonicalize: String,
    /// MONGODB-OIDC: "workforce" (browser sign-in) or "workload" (machine identity); "" (older files) means workforce.
    #[serde(default)]
    pub oidc_mode: String,
    /// Workload only: "azure" | "gcp" | "k8s".
    #[serde(default)]
    pub oidc_environment: String,
    /// Workload only: the audience / resource the token is requested for (azure, gcp).
    #[serde(default)]
    pub oidc_token_resource: String,
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
    #[serde(default)]
    pub environment: String,
    #[serde(default)]
    pub color: String,
    #[serde(default = "default_mcp_access")]
    pub mcp_access: String,
    /// "none" | "socks5" | "http"; "" (older files) means none.
    #[serde(default)]
    pub proxy_type: String,
    #[serde(default)]
    pub proxy_host: String,
    #[serde(default)]
    pub proxy_port: Option<u16>,
    #[serde(default)]
    pub proxy_user: String,
    #[serde(default)]
    pub proxy_password_enc: String,
    /// MONGODB-AWS optional STS session token (obfuscated; a secret like the other `*Enc` fields).
    #[serde(default)]
    pub aws_session_token_enc: String,
    /// Kerberos (GSSAPI) mechanism properties; "" = driver default.
    #[serde(default)]
    pub gssapi_service_name: String,
    #[serde(default)]
    pub gssapi_service_realm: String,
    #[serde(default)]
    pub gssapi_canonicalize: String,
    /// MONGODB-OIDC: "workforce" (browser sign-in) or "workload" (machine identity); "" (older files) means workforce.
    #[serde(default)]
    pub oidc_mode: String,
    /// Workload only: "azure" | "gcp" | "k8s".
    #[serde(default)]
    pub oidc_environment: String,
    /// Workload only: the audience / resource the token is requested for (azure, gcp).
    #[serde(default)]
    pub oidc_token_resource: String,
    /// Legacy pre-Phase-E field; present only in un-migrated files. Cleared on next save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// Epoch millis of the last successful connect; `None` if never connected.
    #[serde(default)]
    pub last_connected_at: Option<i64>,
    /// The `*_enc` fields live in the OS credential store (see `secrets.rs`) and are blank in the file.
    #[serde(default)]
    pub secrets_in_keychain: bool,
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
            mcp_access: clamp_mcp_access(&input.environment, &input.mcp_access),
            environment: input.environment,
            color: input.color,
            proxy_type: input.proxy_type,
            proxy_host: input.proxy_host,
            proxy_port: input.proxy_port,
            proxy_user: input.proxy_user,
            proxy_password_enc: input.proxy_password_enc,
            aws_session_token_enc: input.aws_session_token_enc,
            gssapi_service_name: input.gssapi_service_name,
            gssapi_service_realm: input.gssapi_service_realm,
            gssapi_canonicalize: input.gssapi_canonicalize,
            oidc_mode: input.oidc_mode,
            oidc_environment: input.oidc_environment,
            oidc_token_resource: input.oidc_token_resource,
            uri: None,
            last_connected_at: None,
            secrets_in_keychain: false,
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
                let (last_connected_at, in_keychain) = (c.last_connected_at, c.secrets_in_keychain);
                *c = SavedConnection::from_input(id, input);
                c.last_connected_at = last_connected_at;
                c.secrets_in_keychain = in_keychain;
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
    write_atomic(path, s.as_bytes())
}

/// Replaces `path` with `bytes` without ever leaving a half-written file: the data goes to a temp
/// file in the same directory, is flushed to disk, then renamed over the target.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    use std::io::Write;
    let io = |e: std::io::Error| AppError::Io(e.to_string());
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(e));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_file() {
        let dir = std::env::temp_dir().join("lumiong_test_write_atomic_ok");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.json");
        write_atomic(&path, b"old").unwrap();
        write_atomic(&path, b"new content").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new content");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_atomic_write_keeps_the_existing_file() {
        let dir = std::env::temp_dir().join("lumiong_test_write_atomic_fail");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("f.json");
        std::fs::write(&path, "precious").unwrap();
        // A directory squatting on the temp name makes the temp file impossible to create.
        std::fs::create_dir(dir.join("f.json.tmp")).unwrap();
        assert!(write_atomic(&path, b"replacement").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "precious");
    }

    use super::*;

    /// A saved connection with no secrets, for other modules' tests.
    pub(crate) fn conn(id: u32) -> SavedConnection {
        SavedConnection::from_input(id, input("c", "h"))
    }

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
            environment: String::new(),
            color: String::new(),
            mcp_access: "read".into(),
            proxy_type: String::new(),
            proxy_host: String::new(),
            proxy_port: None,
            proxy_user: String::new(),
            proxy_password_enc: String::new(),
            aws_session_token_enc: String::new(),
            oidc_mode: String::new(),
            oidc_environment: String::new(),
            oidc_token_resource: String::new(),
            gssapi_service_name: String::new(),
            gssapi_service_realm: String::new(),
            gssapi_canonicalize: String::new(),
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
        let dir = std::env::temp_dir().join("lumiong_test_registry_roundtrip");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        let list = upsert(vec![], None, input("Local", "localhost"));
        save(&path, &list).unwrap();
        assert_eq!(load(&path).unwrap(), list);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_missing_file_is_empty() {
        let path = std::env::temp_dir().join("lumiong_test_registry_missing/nope.json");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        assert_eq!(load(&path).unwrap(), Vec::<SavedConnection>::new());
    }

    #[test]
    fn legacy_file_deserializes_with_uri_and_empty_fields() {
        let dir = std::env::temp_dir().join("lumiong_test_registry_legacy");
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
        let dir = std::env::temp_dir().join("lumiong_test_registry_ro_default");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert!(!list[0].read_only);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_files_load_with_read_access_and_prod_is_never_write() {
        let list: Vec<SavedConnection> = serde_json::from_str(r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        assert_eq!(list[0].mcp_access, "read");
        // an input from an older frontend has no field either
        let mut v = serde_json::to_value(input("a", "h")).unwrap();
        v.as_object_mut().unwrap().remove("mcpAccess");
        let i: ConnectionInput = serde_json::from_value(v).unwrap();
        assert_eq!(i.mcp_access, "read");

        let mut w = input("w", "h");
        w.mcp_access = "write".into();
        assert_eq!(upsert(vec![], None, w.clone())[0].mcp_access, "write");
        w.environment = "prod".into();
        assert_eq!(upsert(vec![], None, w)[0].mcp_access, "read");
        assert_eq!(clamp_mcp_access("dev", "off"), "off");
        assert_eq!(clamp_mcp_access("prod", "off"), "off");
        assert_eq!(clamp_mcp_access("dev", "bogus"), "read");
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
        let dir = std::env::temp_dir().join("lumiong_test_registry_last_connected_default");
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
        let dir = std::env::temp_dir().join("lumiong_test_registry_ssh_fields");
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
        assert!(loaded[0].ssh_enabled);
        assert_eq!(loaded[0].ssh_host, "bastion.example.com");
        assert_eq!(loaded[0].ssh_private_key_path, "/home/me/.ssh/id_ed25519");
        assert_eq!(loaded[0].tls_certificate_key_file, "/certs/client.pem");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_file_without_ssh_fields_defaults_them_empty() {
        let dir = std::env::temp_dir().join("lumiong_test_registry_ssh_legacy_default");
        let path = dir.join("connections.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        let list = load(&path).unwrap();
        assert!(!list[0].ssh_enabled);
        assert_eq!(list[0].ssh_host, "");
        assert_eq!(list[0].tls_certificate_key_file, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_file_without_environment_or_color_defaults_them_empty() {
        let list: Vec<SavedConnection> = serde_json::from_str(r#"[{"id":1,"label":"Old","host":"h"}]"#).unwrap();
        assert_eq!(list[0].environment, "");
        assert_eq!(list[0].color, "");
    }

    #[test]
    fn environment_and_color_round_trip_through_upsert_and_json() {
        let mut i = input("Prod", "prod.example.com");
        i.environment = "prod".into();
        i.color = "#e5484d".into();
        let list = upsert(vec![], None, i);
        let json = serde_json::to_string(&list).unwrap();
        assert!(json.contains(r#""environment":"prod""#));
        let back: Vec<SavedConnection> = serde_json::from_str(&json).unwrap();
        assert_eq!(back[0].environment, "prod");
        assert_eq!(back[0].color, "#e5484d");
    }

    #[test]
    fn input_without_environment_or_color_deserializes() {
        let i: ConnectionInput = serde_json::from_str(
            r#"{"label":"a","scheme":"mongodb","host":"h","port":null,"authMethod":"none","user":"","passwordEnc":"","authSource":"","replicaSet":"","tls":false,"extraOptions":"","readOnly":false,"tlsCertificateKeyFile":"","tlsCertificateKeyFilePasswordEnc":"","sshEnabled":false,"sshHost":"","sshPort":22,"sshUser":"","sshAuthMethod":"","sshPasswordEnc":"","sshPrivateKeyPath":"","sshPassphraseEnc":""}"#,
        )
        .unwrap();
        assert_eq!(i.environment, "");
    }

    #[test]
    fn an_old_file_without_proxy_aws_or_kerberos_fields_still_loads() {
        let old = r#"[{"id":1,"label":"old","host":"h","passwordEnc":"x"}]"#;
        let list: Vec<SavedConnection> = serde_json::from_str(old).unwrap();
        assert_eq!(list[0].proxy_type, "");
        assert_eq!(list[0].proxy_port, None);
        assert_eq!(list[0].aws_session_token_enc, "");
        assert_eq!(list[0].gssapi_canonicalize, "");
    }

    #[test]
    fn proxy_and_auth_fields_survive_an_upsert() {
        let mut i = input("p", "h");
        i.proxy_type = "http".into();
        i.proxy_host = "proxy".into();
        i.proxy_port = Some(3128);
        i.proxy_password_enc = "pw".into();
        i.aws_session_token_enc = "tok".into();
        i.gssapi_service_realm = "R".into();
        let c = &upsert(vec![], None, i)[0];
        assert_eq!((c.proxy_type.as_str(), c.proxy_port, c.proxy_password_enc.as_str()), ("http", Some(3128), "pw"));
        assert_eq!((c.aws_session_token_enc.as_str(), c.gssapi_service_realm.as_str()), ("tok", "R"));
    }

    #[test]
    fn oidc_fields_default_for_old_files_and_survive_an_upsert() {
        let list: Vec<SavedConnection> = serde_json::from_str(r#"[{"id":1,"label":"old","host":"h"}]"#).unwrap();
        assert_eq!((list[0].oidc_mode.as_str(), list[0].oidc_environment.as_str(), list[0].oidc_token_resource.as_str()), ("", "", ""));
        let mut i = input("o", "h");
        i.oidc_mode = "workload".into();
        i.oidc_environment = "azure".into();
        i.oidc_token_resource = "api://x".into();
        let c = &upsert(vec![], None, i)[0];
        assert_eq!((c.oidc_mode.as_str(), c.oidc_environment.as_str(), c.oidc_token_resource.as_str()), ("workload", "azure", "api://x"));
    }
}
