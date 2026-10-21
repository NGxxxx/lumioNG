//! Client-Side Field Level Encryption (CSFLE): per-connection configuration and the pure parts of it
//! (KMS credential parsing, local master key validation, namespace parsing). Compiled on every
//! platform so it stays testable; the part that talks to libmongocrypt is `csfle_engine`, built only
//! with the `csfle` feature.
//!
//! Storage split (smaller than adding fields to `SavedConnection`, which every fixture would then
//! have to carry):
//! * `csfle.json` next to `connections.json` holds the non-secret settings per connection id: the
//!   key vault namespace, which KMS providers are configured (names only) and the crypt_shared path.
//! * Everything that is key material or a credential lives in ONE secret per connection
//!   (`KmsSecrets`, account `csfle-<id>` in the OS credential store, or sealed by the vault).
//!   It is never returned to the frontend, logged or audited, and `Debug` prints no value.
use crate::error::AppError;
use base64::Engine;
use mongodb::bson::{doc, spec::BinarySubtype, Binary, Document};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// The local KMS master key is exactly 96 bytes (MongoDB's `local` KMS provider).
pub const LOCAL_KEY_LEN: usize = 96;
/// Where data keys live when the user does not say otherwise (the MongoDB convention).
pub const DEFAULT_KEY_VAULT_NAMESPACE: &str = "encryption.__keyVault";
/// Provider names in the order the UI lists them.
pub const PROVIDERS: [&str; 5] = ["local", "aws", "azure", "gcp", "kmip"];

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

// ---- non-secret settings ---------------------------------------------------------------------------

/// Non-secret CSFLE settings of one saved connection (`csfle.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsfleConfig {
    #[serde(default)]
    pub enabled: bool,
    /// `db.collection` holding the data keys.
    #[serde(default = "default_ns")]
    pub key_vault_namespace: String,
    /// Names of the KMS providers whose credentials are stored (never the credentials themselves).
    #[serde(default)]
    pub providers: Vec<String>,
    /// Path of the `mongo_crypt_v1` shared library, for Queryable Encryption (automatic query
    /// encryption). Stored and handed to libmongocrypt; automatic encryption itself is off.
    #[serde(default)]
    pub crypt_shared_lib_path: String,
}

fn default_ns() -> String {
    DEFAULT_KEY_VAULT_NAMESPACE.to_string()
}

impl Default for CsfleConfig {
    fn default() -> Self {
        CsfleConfig { enabled: false, key_vault_namespace: default_ns(), providers: Vec::new(), crypt_shared_lib_path: String::new() }
    }
}

/// `db.collection` → `(db, collection)`. The collection part may itself contain dots.
pub fn parse_namespace(ns: &str) -> Result<(String, String), AppError> {
    let ns = ns.trim();
    let Some((db, coll)) = ns.split_once('.') else {
        return Err(AppError::Parse("The key vault namespace must look like database.collection".into()));
    };
    if db.is_empty() || coll.is_empty() || db.chars().any(|c| matches!(c, '/' | '\\' | ' ' | '"' | '$' | '\0')) || coll.contains('\0') || coll.starts_with("system.") {
        return Err(AppError::Parse("The key vault namespace must look like database.collection".into()));
    }
    Ok((db.to_string(), coll.to_string()))
}

impl CsfleConfig {
    /// Checks the fields on their own (before the provider list is known).
    pub fn validate_shape(&self) -> Result<(), AppError> {
        parse_namespace(&self.key_vault_namespace)?;
        for p in &self.providers {
            if !PROVIDERS.contains(&p.as_str()) {
                return Err(AppError::Parse(format!("Unknown KMS provider: {p}")));
            }
        }
        if self.crypt_shared_lib_path.contains('\0') {
            return Err(AppError::Parse("Invalid crypt_shared library path".into()));
        }
        Ok(())
    }

    /// Full check: the fields, and at least one provider when encryption is on.
    pub fn validate(&self) -> Result<(), AppError> {
        self.validate_shape()?;
        if self.enabled && self.providers.is_empty() {
            return Err(AppError::Parse("Configure at least one KMS provider".into()));
        }
        Ok(())
    }
}

/// All connections' settings, keyed by connection id (as text, JSON object keys).
pub type CsfleFile = BTreeMap<String, CsfleConfig>;

pub fn load_file(path: &Path) -> Result<CsfleFile, AppError> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| AppError::Parse(e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(CsfleFile::new()),
        Err(e) => Err(AppError::Io(e.to_string())),
    }
}

pub fn save_file(path: &Path, file: &CsfleFile) -> Result<(), AppError> {
    if file.is_empty() {
        return match std::fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(AppError::Io(e.to_string())),
            _ => Ok(()),
        };
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
    }
    let s = serde_json::to_string_pretty(file).map_err(|e| AppError::Serialize(e.to_string()))?;
    crate::registry::write_atomic(path, s.as_bytes())
}

// ---- secrets ---------------------------------------------------------------------------------------

/// What the frontend sends for the KMS providers on save. A provider that is absent keeps whatever
/// is stored; a present one replaces it. Every value is a credential, so nothing here is echoed back.
#[derive(Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KmsInput {
    /// Path of a file with the 96-byte local master key.
    pub local_key_file: Option<String>,
    pub aws: Option<AwsCreds>,
    pub azure: Option<AzureCreds>,
    pub gcp: Option<GcpCreds>,
    pub kmip: Option<KmipCreds>,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwsCreds {
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub session_token: String,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AzureCreds {
    pub tenant_id: String,
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GcpCreds {
    pub email: String,
    /// The service account private key: the base64 DER from the JSON key file, or the PEM text.
    pub private_key: String,
}

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KmipCreds {
    /// `host:port` of the KMIP server.
    pub endpoint: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub ca_file: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub client_cert_file: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub cert_password: String,
}

/// The stored secret of one connection: every KMS credential and the local master key. One JSON
/// document in the credential store. Field names end in the words `redact::redact_text` masks.
#[derive(Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KmsSecrets {
    /// Base64 of the 96-byte local master key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_master_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws: Option<AwsCreds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub azure: Option<AzureCreds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gcp: Option<GcpCreds>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kmip: Option<KmipCreds>,
}

// A derived Debug would print key material into any `{:?}` log line.
impl std::fmt::Debug for KmsSecrets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "KmsSecrets{{providers: {:?}}}", self.configured())
    }
}
impl std::fmt::Debug for KmsInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("KmsInput{..}")
    }
}

/// `Ok(key)` when `bytes` is exactly 96 bytes. The error never contains the bytes.
pub fn validate_local_key(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() != LOCAL_KEY_LEN {
        return Err(AppError::Parse(format!("The local master key must be exactly {LOCAL_KEY_LEN} bytes (got {})", bytes.len())));
    }
    Ok(())
}

/// Reads and validates a local master key file. Raw 96 bytes, or the same bytes as base64 text.
pub fn read_local_key_file(path: &str) -> Result<Vec<u8>, AppError> {
    let bytes = std::fs::read(path).map_err(|e| AppError::Io(format!("Cannot read the local master key file: {e}")))?;
    if bytes.len() == LOCAL_KEY_LEN {
        return Ok(bytes);
    }
    // A base64 text file (with or without a trailing newline) is accepted as a convenience.
    if let Ok(text) = std::str::from_utf8(&bytes) {
        if let Ok(decoded) = b64().decode(text.trim()) {
            validate_local_key(&decoded)?;
            return Ok(decoded);
        }
    }
    validate_local_key(&bytes)?;
    Ok(bytes)
}

fn need(value: &str, what: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Parse(format!("{what} is required")));
    }
    Ok(())
}

impl KmsSecrets {
    /// The providers that currently have credentials.
    pub fn configured(&self) -> Vec<&'static str> {
        let mut v = Vec::new();
        if self.local_master_key.is_some() {
            v.push("local");
        }
        if self.aws.is_some() {
            v.push("aws");
        }
        if self.azure.is_some() {
            v.push("azure");
        }
        if self.gcp.is_some() {
            v.push("gcp");
        }
        if self.kmip.is_some() {
            v.push("kmip");
        }
        v
    }

    /// Validates every present provider.
    pub fn validate(&self) -> Result<(), AppError> {
        if let Some(k) = &self.local_master_key {
            let bytes = b64().decode(k).map_err(|_| AppError::Parse("The stored local master key is not valid base64".into()))?;
            validate_local_key(&bytes)?;
        }
        if let Some(a) = &self.aws {
            need(&a.access_key_id, "AWS access key ID")?;
            need(&a.secret_access_key, "AWS secret access key")?;
        }
        if let Some(a) = &self.azure {
            need(&a.tenant_id, "Azure tenant ID")?;
            need(&a.client_id, "Azure client ID")?;
            need(&a.client_secret, "Azure client secret")?;
        }
        if let Some(g) = &self.gcp {
            need(&g.email, "GCP service account email")?;
            need(&g.private_key, "GCP private key")?;
        }
        if let Some(k) = &self.kmip {
            need(&k.endpoint, "KMIP endpoint")?;
            if !k.endpoint.contains(':') {
                return Err(AppError::Parse("The KMIP endpoint must be host:port".into()));
            }
        }
        Ok(())
    }

    /// Applies a save request: providers present in `input` replace the stored ones, the others are
    /// kept only if they are listed in `keep` (the provider names the user left configured).
    pub fn merged(existing: Option<KmsSecrets>, input: KmsInput, keep: &[String]) -> Result<KmsSecrets, AppError> {
        let old = existing.unwrap_or_default();
        let kept = |name: &str| keep.iter().any(|k| k == name);
        let local_master_key = match input.local_key_file.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(path) => Some(b64().encode(read_local_key_file(path)?)),
            None => old.local_master_key.filter(|_| kept("local")),
        };
        let out = KmsSecrets {
            local_master_key,
            aws: input.aws.or(old.aws.filter(|_| kept("aws"))),
            azure: input.azure.or(old.azure.filter(|_| kept("azure"))),
            gcp: input.gcp.or(old.gcp.filter(|_| kept("gcp"))),
            kmip: input.kmip.or(old.kmip.filter(|_| kept("kmip"))),
        };
        out.validate()?;
        Ok(out)
    }

    pub fn to_json(&self) -> Result<String, AppError> {
        serde_json::to_string(self).map_err(|e| AppError::Serialize(e.to_string()))
    }

    pub fn from_json(s: &str) -> Result<KmsSecrets, AppError> {
        serde_json::from_str(s).map_err(|_| AppError::Parse("The stored KMS credentials are unreadable".into()))
    }

    /// The `kmsProviders` documents libmongocrypt wants, one per configured provider.
    #[cfg_attr(not(feature = "csfle"), allow(dead_code))]
    pub fn provider_docs(&self) -> Result<Vec<(&'static str, Document)>, AppError> {
        let mut out = Vec::new();
        if let Some(k) = &self.local_master_key {
            let bytes = b64().decode(k).map_err(|_| AppError::Parse("The stored local master key is not valid base64".into()))?;
            validate_local_key(&bytes)?;
            out.push(("local", doc! { "key": Binary { subtype: BinarySubtype::Generic, bytes } }));
        }
        if let Some(a) = &self.aws {
            let mut d = doc! { "accessKeyId": &a.access_key_id, "secretAccessKey": &a.secret_access_key };
            if !a.session_token.is_empty() {
                d.insert("sessionToken", &a.session_token);
            }
            out.push(("aws", d));
        }
        if let Some(a) = &self.azure {
            out.push(("azure", doc! { "tenantId": &a.tenant_id, "clientId": &a.client_id, "clientSecret": &a.client_secret }));
        }
        if let Some(g) = &self.gcp {
            out.push(("gcp", doc! { "email": &g.email, "privateKey": gcp_private_key(&g.private_key) }));
        }
        if let Some(k) = &self.kmip {
            out.push(("kmip", doc! { "endpoint": k.endpoint.trim() }));
        }
        Ok(out)
    }
}

#[cfg_attr(not(feature = "csfle"), allow(dead_code))]
/// libmongocrypt wants the key as base64 DER. A PEM block is converted by dropping its armor lines.
fn gcp_private_key(raw: &str) -> String {
    let t = raw.trim();
    if t.starts_with("-----BEGIN") {
        return t.lines().filter(|l| !l.starts_with("-----")).map(str::trim).collect::<String>();
    }
    t.to_string()
}

// ---- values handed to the frontend (no secrets) ------------------------------------------------------

/// What the settings dialog shows: the settings, which providers have credentials, and whether they
/// can be read right now (a sealed credential is unreadable while the vault is locked).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsfleView {
    pub config: CsfleConfig,
    pub stored_providers: Vec<String>,
}

/// A data key from the key vault, reduced to what a picker needs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataKeyInfo {
    /// Base64 of the UUID bytes.
    pub id: String,
    pub key_alt_names: Vec<String>,
    pub provider: String,
}

/// Algorithms of explicit encryption offered in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Algo {
    Deterministic,
    Random,
}

pub fn parse_algorithm(s: &str) -> Result<Algo, AppError> {
    match s {
        "deterministic" => Ok(Algo::Deterministic),
        "random" => Ok(Algo::Random),
        _ => Err(AppError::Parse("The algorithm must be deterministic or random".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lumiong_csfle_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn local_key_must_be_exactly_96_bytes() {
        assert!(validate_local_key(&[7u8; 96]).is_ok());
        for n in [0usize, 1, 32, 95, 97, 128] {
            let err = validate_local_key(&vec![1u8; n]).unwrap_err().to_string();
            assert!(err.contains("96"), "{err}");
        }
    }

    #[test]
    fn local_key_file_accepts_raw_or_base64_and_rejects_the_rest() {
        let dir = tmp("keyfile");
        let raw = dir.join("raw.key");
        std::fs::write(&raw, [9u8; 96]).unwrap();
        assert_eq!(read_local_key_file(raw.to_str().unwrap()).unwrap(), vec![9u8; 96]);

        let text = dir.join("b64.key");
        std::fs::write(&text, format!("{}\n", b64().encode([5u8; 96]))).unwrap();
        assert_eq!(read_local_key_file(text.to_str().unwrap()).unwrap(), vec![5u8; 96]);

        let short = dir.join("short.key");
        std::fs::write(&short, [1u8; 32]).unwrap();
        assert!(read_local_key_file(short.to_str().unwrap()).is_err());
        assert!(read_local_key_file(dir.join("missing").to_str().unwrap()).is_err());
    }

    #[test]
    fn key_errors_never_contain_the_key() {
        let key = [0xABu8; 31];
        let msg = validate_local_key(&key).unwrap_err().to_string();
        assert!(!msg.contains("171") && !msg.contains("AB"), "{msg}");
    }

    #[test]
    fn namespace_parsing() {
        assert_eq!(parse_namespace("encryption.__keyVault").unwrap(), ("encryption".into(), "__keyVault".into()));
        assert_eq!(parse_namespace(" a.b.c ").unwrap(), ("a".into(), "b.c".into()));
        for bad in ["", "nodot", ".coll", "db.", "d b.c", "db.system.keys", "$db.c"] {
            assert!(parse_namespace(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn config_defaults_for_old_or_partial_files() {
        let f: CsfleFile = serde_json::from_str(r#"{"3": {"enabled": true}}"#).unwrap();
        let c = &f["3"];
        assert!(c.enabled && c.providers.is_empty());
        assert_eq!(c.key_vault_namespace, DEFAULT_KEY_VAULT_NAMESPACE);
        assert!(c.validate().is_err(), "enabled without providers");
        let ok = CsfleConfig { enabled: true, providers: vec!["local".into()], ..Default::default() };
        assert!(ok.validate().is_ok());
        let bad = CsfleConfig { providers: vec!["vault".into()], ..Default::default() };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn config_file_round_trips_and_deleting_the_last_entry_removes_the_file() {
        let path = tmp("file").join("csfle.json");
        assert!(load_file(&path).unwrap().is_empty());
        let mut f = CsfleFile::new();
        f.insert("4".into(), CsfleConfig { enabled: true, providers: vec!["aws".into()], ..Default::default() });
        save_file(&path, &f).unwrap();
        assert_eq!(load_file(&path).unwrap(), f);
        save_file(&path, &CsfleFile::new()).unwrap();
        assert!(!path.exists());
    }

    fn input_with_aws() -> KmsInput {
        KmsInput { aws: Some(AwsCreds { access_key_id: "AKIA1".into(), secret_access_key: "sek".into(), session_token: String::new() }), ..Default::default() }
    }

    #[test]
    fn parses_every_kms_provider_into_driver_documents() {
        let dir = tmp("providers");
        let key = dir.join("master.key");
        std::fs::write(&key, [3u8; 96]).unwrap();
        let input = KmsInput {
            local_key_file: Some(key.to_str().unwrap().into()),
            aws: Some(AwsCreds { access_key_id: "AKIA".into(), secret_access_key: "s".into(), session_token: "tok".into() }),
            azure: Some(AzureCreds { tenant_id: "t".into(), client_id: "c".into(), client_secret: "cs".into() }),
            gcp: Some(GcpCreds { email: "sa@x.iam".into(), private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB\n-----END PRIVATE KEY-----\n".into() }),
            kmip: Some(KmipCreds { endpoint: "kmip.local:5696".into(), ..Default::default() }),
        };
        let secrets = KmsSecrets::merged(None, input, &[]).unwrap();
        assert_eq!(secrets.configured(), vec!["local", "aws", "azure", "gcp", "kmip"]);
        let docs: std::collections::HashMap<_, _> = secrets.provider_docs().unwrap().into_iter().collect();
        assert_eq!(docs["local"].get_binary_generic("key").unwrap().len(), 96);
        assert_eq!(docs["aws"].get_str("sessionToken").unwrap(), "tok");
        assert_eq!(docs["azure"].get_str("clientSecret").unwrap(), "cs");
        assert_eq!(docs["gcp"].get_str("privateKey").unwrap(), "AAAABBBB");
        assert_eq!(docs["kmip"].get_str("endpoint").unwrap(), "kmip.local:5696");
        // Without a session token the field is left out entirely.
        let aws_only = KmsSecrets::merged(None, input_with_aws(), &[]).unwrap();
        assert!(!aws_only.provider_docs().unwrap()[0].1.contains_key("sessionToken"));
    }

    #[test]
    fn incomplete_credentials_are_rejected() {
        let missing_secret = KmsInput { aws: Some(AwsCreds { access_key_id: "A".into(), secret_access_key: " ".into(), session_token: String::new() }), ..Default::default() };
        assert!(KmsSecrets::merged(None, missing_secret, &[]).is_err());
        let bad_kmip = KmsInput { kmip: Some(KmipCreds { endpoint: "no-port".into(), ..KmipCreds::default() }), ..Default::default() };
        assert!(KmsSecrets::merged(None, bad_kmip, &[]).is_err());
        let short_key = tmp("shortkey").join("k");
        std::fs::write(&short_key, [1u8; 10]).unwrap();
        let input = KmsInput { local_key_file: Some(short_key.to_str().unwrap().into()), ..Default::default() };
        assert!(KmsSecrets::merged(None, input, &[]).is_err());
    }

    #[test]
    fn save_keeps_listed_providers_and_drops_the_rest() {
        let first = KmsSecrets::merged(None, input_with_aws(), &[]).unwrap();
        // The user edits nothing but keeps AWS: credentials survive without being re-sent.
        let kept = KmsSecrets::merged(Some(first.clone()), KmsInput::default(), &["aws".into()]).unwrap();
        assert_eq!(kept, first);
        // The user removed AWS from the list.
        let dropped = KmsSecrets::merged(Some(first), KmsInput::default(), &[]).unwrap();
        assert!(dropped.configured().is_empty());
    }

    #[test]
    fn secrets_serialize_to_json_and_back_but_debug_prints_no_value() {
        let s = KmsSecrets::merged(None, input_with_aws(), &[]).unwrap();
        let back = KmsSecrets::from_json(&s.to_json().unwrap()).unwrap();
        assert_eq!(back, s);
        let dbg = format!("{s:?}");
        assert!(!dbg.contains("sek") && !dbg.contains("AKIA1"), "{dbg}");
        assert!(KmsSecrets::from_json("garbage").is_err());
        let input_dbg = format!("{:?}", input_with_aws());
        assert!(!input_dbg.contains("sek"));
    }

    #[test]
    fn algorithm_names_map_to_libmongocrypt_algorithms() {
        assert_eq!(parse_algorithm("deterministic").unwrap(), Algo::Deterministic);
        assert_eq!(parse_algorithm("random").unwrap(), Algo::Random);
        assert!(parse_algorithm("rangePreview").is_err());
    }
}
