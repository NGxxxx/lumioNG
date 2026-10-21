//! The libmongocrypt side of CSFLE (compiled only with the `csfle` feature): an auto-decrypting
//! client for reads and a `ClientEncryption` handle for explicit encryption of single values.
//!
//! The client is built with `bypass_auto_encryption = true`: reads are decrypted automatically while
//! nothing is encrypted automatically on write, so neither `mongocryptd` nor `crypt_shared` is
//! needed. Writes of encrypted values go through the explicit `encrypt` call and the normal
//! insert/replace commands.
use crate::csfle::{Algo, CsfleConfig, DataKeyInfo, KmipCreds, KmsSecrets};
use crate::error::AppError;
use futures::TryStreamExt;
use mongodb::bson::{doc, spec::BinarySubtype, Binary, Bson, Document, RawBson};
use mongodb::client_encryption::{AwsMasterKey, AzureMasterKey, ClientEncryption, GcpMasterKey, KmipMasterKey, LocalMasterKey, MasterKey};
use mongodb::mongocrypt::ctx::{Algorithm, KmsProvider};
use mongodb::options::{ClientOptions, TlsOptions};
use mongodb::{Client, Namespace};

type ProviderList = Vec<(KmsProvider, Document, Option<TlsOptions>)>;

fn crypt_err(e: impl std::fmt::Display) -> AppError {
    AppError::Query(format!("Encryption: {e}"))
}

fn namespace(cfg: &CsfleConfig) -> Result<Namespace, AppError> {
    let (db, coll) = crate::csfle::parse_namespace(&cfg.key_vault_namespace)?;
    Ok(Namespace { db, coll })
}

fn kmip_tls(k: &KmipCreds) -> Option<TlsOptions> {
    if k.ca_file.is_empty() && k.client_cert_file.is_empty() && k.cert_password.is_empty() {
        return None;
    }
    let mut tls = TlsOptions::default();
    if !k.ca_file.is_empty() {
        tls.ca_file_path = Some(k.ca_file.clone().into());
    }
    if !k.client_cert_file.is_empty() {
        tls.cert_key_file_path = Some(k.client_cert_file.clone().into());
    }
    if !k.cert_password.is_empty() {
        tls.tls_certificate_key_file_password = Some(k.cert_password.clone().into_bytes());
    }
    Some(tls)
}

fn providers(secrets: &KmsSecrets) -> Result<ProviderList, AppError> {
    let mut out: ProviderList = Vec::new();
    for (name, d) in secrets.provider_docs()? {
        let (provider, tls) = match name {
            "local" => (KmsProvider::local(), None),
            "aws" => (KmsProvider::aws(), None),
            "azure" => (KmsProvider::azure(), None),
            "gcp" => (KmsProvider::gcp(), None),
            _ => (KmsProvider::kmip(), secrets.kmip.as_ref().and_then(kmip_tls)),
        };
        out.push((provider, d, tls));
    }
    if out.is_empty() {
        return Err(AppError::Query("No KMS provider has stored credentials".into()));
    }
    Ok(out)
}

/// Builds the session client: same options as a plain connection, plus automatic decryption.
pub async fn auto_decrypting_client(opts: ClientOptions, cfg: &CsfleConfig, secrets: &KmsSecrets) -> Result<Client, AppError> {
    let mut builder = Client::encrypted_builder(opts, namespace(cfg)?, providers(secrets)?).map_err(crypt_err)?.bypass_auto_encryption(true);
    // Queryable Encryption's crypt_shared library: only its location is configurable in this version.
    if !cfg.crypt_shared_lib_path.trim().is_empty() {
        builder = builder.extra_options(doc! { "cryptSharedLibPath": cfg.crypt_shared_lib_path.trim() });
    }
    builder.build().await.map_err(crypt_err)
}

/// The explicit-encryption handle of a session; `client` is the session's own client.
pub fn client_encryption(client: Client, cfg: &CsfleConfig, secrets: &KmsSecrets) -> Result<ClientEncryption, AppError> {
    ClientEncryption::new(client, namespace(cfg)?, providers(secrets)?).map_err(crypt_err)
}

fn uuid_binary(id_b64: &str) -> Result<Binary, AppError> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(id_b64.trim()).map_err(|_| AppError::Parse("Invalid key id".into()))?;
    if bytes.len() != 16 {
        return Err(AppError::Parse("Invalid key id".into()));
    }
    Ok(Binary { subtype: BinarySubtype::Uuid, bytes })
}

/// Encrypts one value (a Bson value from the editor) with a data key picked by id or alternate name.
pub async fn encrypt_value(enc: &ClientEncryption, value: Bson, key_id: Option<&str>, key_alt_name: Option<&str>, algo: Algo) -> Result<Binary, AppError> {
    let raw = RawBson::try_from(value).map_err(|e| AppError::Parse(format!("Cannot encrypt this value: {e}")))?;
    let algorithm = match algo {
        Algo::Deterministic => Algorithm::Deterministic,
        Algo::Random => Algorithm::Random,
    };
    let action = match (key_id.filter(|s| !s.trim().is_empty()), key_alt_name.filter(|s| !s.trim().is_empty())) {
        (Some(id), _) => enc.encrypt(raw, uuid_binary(id)?, algorithm),
        (None, Some(name)) => enc.encrypt(raw, name.trim().to_string(), algorithm),
        (None, None) => return Err(AppError::Parse("Choose an encryption key".into())),
    };
    action.await.map_err(crypt_err)
}

/// Decrypts one binary subtype 6 value (the round-trip test uses it to check the explicit path).
#[cfg(test)]
pub async fn decrypt_value(enc: &ClientEncryption, value: &Binary) -> Result<Bson, AppError> {
    let raw = mongodb::bson::RawBinaryRef { subtype: value.subtype, bytes: &value.bytes };
    let out = enc.decrypt(raw).await.map_err(crypt_err)?;
    Bson::try_from(out).map_err(crypt_err)
}

/// The data keys in the key vault.
pub async fn list_keys(enc: &ClientEncryption) -> Result<Vec<DataKeyInfo>, AppError> {
    use base64::Engine;
    let cursor = enc.get_keys().await.map_err(crypt_err)?;
    let raws: Vec<_> = cursor.try_collect().await.map_err(crypt_err)?;
    let mut out = Vec::new();
    for raw in raws {
        let d = Document::try_from(raw).map_err(crypt_err)?;
        let Some(Bson::Binary(id)) = d.get("_id") else { continue };
        let names = d.get_array("keyAltNames").map(|a| a.iter().filter_map(|b| b.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let provider = d.get_document("masterKey").ok().and_then(|m| m.get_str("provider").ok()).unwrap_or("").to_string();
        out.push(DataKeyInfo { id: base64::engine::general_purpose::STANDARD.encode(&id.bytes), key_alt_names: names, provider });
    }
    Ok(out)
}

/// The master key description for a new data key: `master_key_json` is the provider-specific part
/// (AWS region + key ARN, Azure key vault endpoint + key name, GCP project/location/key ring/key name;
/// nothing for local and optional for KMIP).
pub fn master_key(provider: &str, master_key_json: Option<&str>) -> Result<MasterKey, AppError> {
    let text = master_key_json.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("{}");
    let bad = |e: serde_json::Error| AppError::Parse(format!("Invalid master key description: {e}"));
    Ok(match provider {
        "local" => LocalMasterKey::builder().build().into(),
        "aws" => {
            let k: AwsMasterKey = serde_json::from_str(text).map_err(bad)?;
            if k.region.trim().is_empty() || k.key.trim().is_empty() {
                return Err(AppError::Parse("AWS needs a region and a key ARN".into()));
            }
            k.into()
        }
        "azure" => {
            let k: AzureMasterKey = serde_json::from_str(text).map_err(bad)?;
            if k.key_vault_endpoint.trim().is_empty() || k.key_name.trim().is_empty() {
                return Err(AppError::Parse("Azure needs a key vault endpoint and a key name".into()));
            }
            k.into()
        }
        "gcp" => {
            let k: GcpMasterKey = serde_json::from_str(text).map_err(bad)?;
            if [&k.project_id, &k.location, &k.key_ring, &k.key_name].iter().any(|v| v.trim().is_empty()) {
                return Err(AppError::Parse("GCP needs a project, location, key ring and key name".into()));
            }
            k.into()
        }
        "kmip" => serde_json::from_str::<KmipMasterKey>(text).map_err(bad)?.into(),
        _ => return Err(AppError::Parse(format!("Unknown KMS provider: {provider}"))),
    })
}

/// Creates a data key in the key vault and returns its id (base64 of the UUID bytes).
pub async fn create_data_key(enc: &ClientEncryption, master: MasterKey, alt_name: Option<&str>) -> Result<String, AppError> {
    use base64::Engine;
    let mut action = enc.create_data_key(master);
    if let Some(n) = alt_name.map(str::trim).filter(|s| !s.is_empty()) {
        action = action.key_alt_names([n.to_string()]);
    }
    let id = action.await.map_err(crypt_err)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(id.bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csfle::{CsfleConfig, KmsSecrets};
    use mongodb::bson::{doc, spec::BinarySubtype, Bson};

    fn local_secrets() -> KmsSecrets {
        use base64::Engine;
        let mut key = [0u8; 96];
        getrandom::fill(&mut key).unwrap();
        KmsSecrets { local_master_key: Some(base64::engine::general_purpose::STANDARD.encode(key)), ..Default::default() }
    }

    #[test]
    fn master_key_descriptions_are_checked_per_provider() {
        assert!(master_key("local", None).is_ok());
        assert!(master_key("aws", Some(r#"{"region":"us-east-1","key":"arn:aws:kms:us-east-1:1:key/x"}"#)).is_ok());
        assert!(master_key("aws", Some(r#"{"region":"us-east-1"}"#)).is_err());
        assert!(master_key("azure", Some(r#"{"keyVaultEndpoint":"v.vault.azure.net","keyName":"k"}"#)).is_ok());
        assert!(master_key("azure", None).is_err());
        assert!(master_key("gcp", Some(r#"{"projectId":"p","location":"global","keyRing":"r","keyName":"k"}"#)).is_ok());
        assert!(master_key("gcp", Some(r#"{"projectId":"p"}"#)).is_err());
        assert!(master_key("kmip", None).is_ok());
        assert!(master_key("vault", None).is_err());
        assert!(master_key("aws", Some("not json")).is_err());
    }

    #[test]
    fn uuid_key_ids_must_be_16_bytes_of_base64() {
        assert!(uuid_binary("AAAAAAAAAAAAAAAAAAAAAA==").is_ok());
        assert!(uuid_binary("AAAA").is_err());
        assert!(uuid_binary("%%%").is_err());
    }

    /// Round trip with the `local` KMS provider on a real MongoDB (7.0 on :27017 by default):
    /// create a data key, encrypt explicitly, insert, read back decrypted, and read the same document through
    /// a plain client to see the ciphertext. Run with `cargo test -- --ignored csfle_local_round_trip`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a MongoDB at LUMIO_TEST_MONGO_URI (default mongodb://localhost:27017/?directConnection=true)"]
    async fn csfle_local_round_trip() {
        let uri = std::env::var("LUMIO_TEST_MONGO_URI").unwrap_or_else(|_| "mongodb://localhost:27017/?directConnection=true".into());
        let secrets = local_secrets();
        let cfg = CsfleConfig { enabled: true, key_vault_namespace: "lumio_csfle_test.__keyVault".into(), providers: vec!["local".into()], crypt_shared_lib_path: String::new() };
        let plain = Client::with_options(ClientOptions::parse(&uri).await.unwrap()).unwrap();
        plain.database("lumio_csfle_test").drop().await.unwrap();

        let client = auto_decrypting_client(ClientOptions::parse(&uri).await.unwrap(), &cfg, &secrets).await.unwrap();
        let enc = client_encryption(client.clone(), &cfg, &secrets).unwrap();
        let key_id = create_data_key(&enc, master_key("local", None).unwrap(), Some("lumio-test")).await.unwrap();
        let keys = list_keys(&enc).await.unwrap();
        assert!(keys.iter().any(|k| k.id == key_id && k.key_alt_names == vec!["lumio-test".to_string()] && k.provider == "local"));

        let a = encrypt_value(&enc, Bson::String("123-45-6789".into()), Some(&key_id), None, Algo::Deterministic).await.unwrap();
        let b = encrypt_value(&enc, Bson::String("123-45-6789".into()), None, Some("lumio-test"), Algo::Deterministic).await.unwrap();
        let r1 = encrypt_value(&enc, Bson::String("123-45-6789".into()), Some(&key_id), None, Algo::Random).await.unwrap();
        let r2 = encrypt_value(&enc, Bson::String("123-45-6789".into()), Some(&key_id), None, Algo::Random).await.unwrap();
        assert_eq!(a.subtype, BinarySubtype::Encrypted);
        assert_eq!(a.bytes, b.bytes, "deterministic: same value and key, same ciphertext (by id or by alt name)");
        assert_ne!(r1.bytes, r2.bytes, "random: different ciphertext each time");
        assert_eq!(decrypt_value(&enc, &a).await.unwrap(), Bson::String("123-45-6789".into()));
        assert!(encrypt_value(&enc, Bson::Int32(1), None, None, Algo::Random).await.is_err(), "a key is required");

        let coll = client.database("lumio_csfle_test").collection::<mongodb::bson::Document>("people");
        coll.insert_one(doc! { "_id": 1, "name": "Ann", "ssn": Bson::Binary(a.clone()), "pin": Bson::Binary(r1) }).await.unwrap();

        // The auto-decrypting client shows plaintext.
        let got = coll.find_one(doc! { "_id": 1 }).await.unwrap().unwrap();
        assert_eq!(got.get_str("ssn").unwrap(), "123-45-6789");
        assert_eq!(got.get_str("pin").unwrap(), "123-45-6789");
        // Deterministic fields can be matched by equality with the ciphertext.
        assert!(coll.find_one(doc! { "ssn": Bson::Binary(a.clone()) }).await.unwrap().is_some());
        // A client without encryption sees BinData subtype 6.
        let raw = plain.database("lumio_csfle_test").collection::<mongodb::bson::Document>("people").find_one(doc! { "_id": 1 }).await.unwrap().unwrap();
        match raw.get("ssn") {
            Some(Bson::Binary(b)) => assert_eq!(b.subtype, BinarySubtype::Encrypted),
            other => panic!("expected ciphertext, got {other:?}"),
        }
        plain.database("lumio_csfle_test").drop().await.unwrap();
    }

    struct Live {
        uri: String,
        cfg: CsfleConfig,
        secrets: KmsSecrets,
        plain: Client,
        client: Client,
        enc: ClientEncryption,
        key_id: String,
    }

    async fn live(db: &str) -> Live {
        let uri = std::env::var("LUMIO_TEST_MONGO_URI").unwrap_or_else(|_| "mongodb://localhost:27017/?directConnection=true".into());
        let secrets = local_secrets();
        let cfg = CsfleConfig { enabled: true, key_vault_namespace: format!("{db}.__keyVault"), providers: vec!["local".into()], crypt_shared_lib_path: String::new() };
        let plain = Client::with_options(ClientOptions::parse(&uri).await.unwrap()).unwrap();
        plain.database(db).drop().await.unwrap();
        let client = auto_decrypting_client(ClientOptions::parse(&uri).await.unwrap(), &cfg, &secrets).await.unwrap();
        let enc = client_encryption(client.clone(), &cfg, &secrets).unwrap();
        let key_id = create_data_key(&enc, master_key("local", None).unwrap(), Some("k")).await.unwrap();
        Live { uri, cfg, secrets, plain, client, enc, key_id }
    }

    /// Editing a non-encrypted field of a document that has an encrypted one must leave the stored
    /// ciphertext alone (the editor only ever sees plaintext). Needs a MongoDB; see the round-trip test.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a MongoDB at LUMIO_TEST_MONGO_URI (default mongodb://localhost:27017/?directConnection=true)"]
    async fn csfle_editing_a_plain_field_keeps_the_ciphertext_of_encrypted_ones() {
        use crate::commands::csfle::{guard_replacement, PLAINTEXT_REQUIRED};
        let l = live("lumio_csfle_edit").await;
        let ssn = encrypt_value(&l.enc, Bson::String("123-45".into()), Some(&l.key_id), None, Algo::Random).await.unwrap();
        let name = "lumio_csfle_edit";
        let coll = l.client.database(name).collection::<mongodb::bson::Document>("people");
        coll.insert_one(doc! { "_id": 1, "name": "Ann", "ssn": Bson::Binary(ssn.clone()) }).await.unwrap();
        let raw_of = || async { l.plain.database(name).collection::<mongodb::bson::Document>("people").find_one(doc! { "_id": 1 }).await.unwrap().unwrap() };
        let filter = doc! { "_id": 1 };

        // What the editor holds: the decrypted view, with `name` edited.
        let mut edited = coll.find_one(filter.clone()).await.unwrap().unwrap();
        assert_eq!(edited.get_str("ssn").unwrap(), "123-45");
        edited.insert("name", "Anna");
        let safe = guard_replacement(&l.plain, &l.client, name, "people", &filter, edited.clone(), &[]).await.unwrap();
        coll.replace_one(filter.clone(), safe).await.unwrap();
        let after = raw_of().await;
        assert_eq!(after.get_str("name").unwrap(), "Anna");
        match after.get("ssn") {
            Some(Bson::Binary(b)) => assert_eq!((b.subtype, &b.bytes), (BinarySubtype::Encrypted, &ssn.bytes), "ciphertext must be untouched"),
            other => panic!("ssn was turned into {other:?}"),
        }

        // Changing the encrypted value to plain text is refused without the explicit flag...
        edited.insert("ssn", "999-99");
        let err = guard_replacement(&l.plain, &l.client, name, "people", &filter, edited.clone(), &[]).await.unwrap_err().to_string();
        assert!(err.contains(&format!("{PLAINTEXT_REQUIRED}ssn")), "{err}");
        assert!(matches!(raw_of().await.get("ssn"), Some(Bson::Binary(_))), "a refused save writes nothing");
        // ...and stored as plain text once the user confirmed that path.
        let plain_ok = guard_replacement(&l.plain, &l.client, name, "people", &filter, edited, &["ssn".to_string()]).await.unwrap();
        coll.replace_one(filter, plain_ok).await.unwrap();
        assert_eq!(raw_of().await.get_str("ssn").unwrap(), "999-99");

        // A cell edit ($set) of an encrypted field is refused the same way; other fields are fine.
        l.plain.database(name).collection::<mongodb::bson::Document>("people").update_one(doc! { "_id": 1 }, doc! { "$set": { "ssn": Bson::Binary(ssn) } }).await.unwrap();
        use crate::commands::csfle::guard_update;
        let err = guard_update(&l.plain, name, "people", &doc! { "_id": 1 }, &doc! { "$set": { "ssn": "1" } }, &[]).await.unwrap_err().to_string();
        assert!(err.contains(&format!("{PLAINTEXT_REQUIRED}ssn")), "{err}");
        guard_update(&l.plain, name, "people", &doc! { "_id": 1 }, &doc! { "$set": { "name": "B" } }, &[]).await.unwrap();
        guard_update(&l.plain, name, "people", &doc! { "_id": 1 }, &doc! { "$set": { "ssn": "1" } }, &["ssn".to_string()]).await.unwrap();
        // Renaming the encrypted field in the editor is not a delete.
        let mut moved = coll.find_one(doc! { "_id": 1 }).await.unwrap().unwrap();
        let v = moved.remove("ssn").unwrap();
        moved.insert("ssn2", v);
        let err = guard_replacement(&l.plain, &l.client, name, "people", &doc! { "_id": 1 }, moved, &[]).await.unwrap_err().to_string();
        assert!(err.contains(&format!("{PLAINTEXT_REQUIRED}ssn")), "{err}");
        l.plain.database(name).drop().await.unwrap();
    }

    /// A key that disappeared from the key vault makes the decrypting client fail the whole read; the
    /// raw client still returns the ciphertext, which is what the fallback serves.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a MongoDB at LUMIO_TEST_MONGO_URI (default mongodb://localhost:27017/?directConnection=true)"]
    async fn csfle_unusable_key_falls_back_to_ciphertext() {
        use crate::commands::csfle::read_with_fallback;
        use crate::error::AppError;
        let l = live("lumio_csfle_fallback").await;
        let name = "lumio_csfle_fallback";
        let ct = encrypt_value(&l.enc, Bson::String("secret".into()), Some(&l.key_id), None, Algo::Random).await.unwrap();
        l.client.database(name).collection::<mongodb::bson::Document>("c").insert_one(doc! { "_id": 1, "f": Bson::Binary(ct) }).await.unwrap();
        // The data key is gone (a fresh client has no cached copy of it).
        l.plain.database(name).collection::<mongodb::bson::Document>("__keyVault").delete_many(doc! {}).await.unwrap();
        let read = |c: Client| async move {
            Ok::<_, AppError>(c.database("lumio_csfle_fallback").collection::<mongodb::bson::Document>("c").find_one(doc! { "_id": 1 }).await?)
        };
        // Key vault reads use majority read concern, which on a standalone 4.2 can lag the delete briefly.
        let mut attempt = 0;
        let (fresh, direct) = loop {
            let fresh = auto_decrypting_client(ClientOptions::parse(&l.uri).await.unwrap(), &l.cfg, &l.secrets).await.unwrap();
            match read(fresh.clone()).await {
                Err(e) => break (fresh, e),
                Ok(_) if attempt < 40 => {
                    attempt += 1;
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
                Ok(_) => panic!("the read kept succeeding after the data key was deleted"),
            }
        };
        assert!(direct.is_encryption(), "expected a libmongocrypt error, got {direct}");
        let fresh2 = fresh.clone();
        let (res, reason) = read_with_fallback(fresh, Some(l.plain.clone()), read).await;
        let doc = res.unwrap().unwrap();
        assert!(matches!(doc.get("f"), Some(Bson::Binary(b)) if b.subtype == BinarySubtype::Encrypted));
        assert!(reason.is_some_and(|r| r.starts_with(crate::error::ENCRYPTION_PREFIX)));

        // Saving what the fallback showed (ciphertext only) must not need the unusable key.
        let mut shown = doc.clone();
        shown.insert("note", "edited while decryption is unavailable");
        let saved = crate::commands::csfle::guard_replacement(&l.plain, &fresh2, name, "c", &doc! { "_id": 1 }, shown, &[]).await.unwrap();
        assert!(matches!(saved.get("f"), Some(Bson::Binary(b)) if b.subtype == BinarySubtype::Encrypted));
        l.plain.database(name).drop().await.unwrap();
    }

    /// Delete a document with an encrypted field, snapshot it through the raw client (what `find_raw_by_ids`
    /// does), restore it through the session client as undo does (canonical JSON in between): the raw client
    /// must still see the same BinData subtype 6, not the decrypted text.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a MongoDB at LUMIO_TEST_MONGO_URI (default mongodb://localhost:27017/?directConnection=true) and --features csfle"]
    async fn csfle_undo_of_a_delete_restores_the_ciphertext() {
        use crate::json_bson::canonical_string_to_doc;
        let l = live("lumio_csfle_undo").await;
        let name = "lumio_csfle_undo";
        let ssn = encrypt_value(&l.enc, Bson::String("123-45".into()), Some(&l.key_id), None, Algo::Random).await.unwrap();
        let session = l.client.database(name).collection::<mongodb::bson::Document>("people");
        let raw = l.plain.database(name).collection::<mongodb::bson::Document>("people");
        session.insert_one(doc! { "_id": 1, "name": "Ann", "ssn": Bson::Binary(ssn.clone()) }).await.unwrap();

        // The grid sees plaintext; the snapshot must come from the raw client.
        assert_eq!(session.find_one(doc! { "_id": 1 }).await.unwrap().unwrap().get_str("ssn").unwrap(), "123-45");
        let snapshot = crate::bson_json::doc_to_canonical_string(raw.find_one(doc! { "_id": 1 }).await.unwrap().unwrap()).unwrap();

        session.delete_one(doc! { "_id": 1 }).await.unwrap();
        assert!(raw.find_one(doc! { "_id": 1 }).await.unwrap().is_none());

        // Undo: the snapshot text goes through insert_document's parser and the session client.
        session.insert_one(canonical_string_to_doc(&snapshot).unwrap()).await.unwrap();
        let stored = raw.find_one(doc! { "_id": 1 }).await.unwrap().unwrap();
        match stored.get("ssn") {
            Some(Bson::Binary(b)) => assert_eq!((b.subtype, &b.bytes), (BinarySubtype::Encrypted, &ssn.bytes), "ciphertext must be restored verbatim"),
            other => panic!("ssn was restored as {other:?}"),
        }
        assert_eq!(stored.get_str("name").unwrap(), "Ann");
        // ...and it still decrypts for the session.
        assert_eq!(session.find_one(doc! { "_id": 1 }).await.unwrap().unwrap().get_str("ssn").unwrap(), "123-45");
        l.plain.database(name).drop().await.unwrap();
    }
}
