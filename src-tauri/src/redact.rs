//! Scrubs secrets from text before it reaches a log, crash report or diagnostics bundle.
//! Shared by every writer of such text — never log a URI or error message without passing it through here.
use regex::Regex;
use std::sync::LazyLock;

const MASK: &str = "****";

/// Option / field names whose value is a secret (matched as a suffix of the key, case-insensitive).
const SECRET_NAMES: &str = "password|passwd|pwd|passphrase|secret|token|api_?key|access_?key|secret_?key|private_?key|master_?key";

/// `scheme://user:pass@` — the password may contain an unencoded `@`, so match up to the last one in the authority.
static USERINFO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\b([a-z][a-z0-9+.-]*://[^\s/?#@:]+):[^\s/?#]*@").unwrap());
/// `password=…`, `proxyPassword=…`, `tlsCertificateKeyFilePassword=…`, `apiKey=…` in a query string or option list.
static KEY_VALUE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r#"(?i)\b([a-z_]*(?:{SECRET_NAMES}))=[^&\s;,"']+"#)).unwrap());
/// `AWS_SESSION_TOKEN:xxx` inside `authMechanismProperties=` (other properties, e.g. `SERVICE_NAME:mongodb`, are not secret).
static AWS_TOKEN_PROP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\b(AWS_SESSION_TOKEN):[^,&\s"']+"#).unwrap());
/// `"password": "…"` in JSON-shaped text.
static JSON_FIELD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r#"(?i)("[a-z_]*(?:{SECRET_NAMES})"\s*:\s*)"[^"]*""#)).unwrap());
static BEARER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+").unwrap());

/// Masks the password of a connection URI's userinfo and any secret-like query option.
/// A URI without credentials is returned unchanged.
pub fn redact_uri(s: &str) -> String {
    let s = USERINFO.replace_all(s, format!("$1:{MASK}@").as_str());
    let s = KEY_VALUE.replace_all(&s, format!("$1={MASK}").as_str());
    AWS_TOKEN_PROP.replace_all(&s, format!("$1:{MASK}").as_str()).into_owned()
}

/// `redact_uri` for every URI in free text, plus JSON secret fields and `Bearer` tokens.
pub fn redact_text(s: &str) -> String {
    let s = redact_uri(s);
    let s = JSON_FIELD.replace_all(&s, format!("$1\"{MASK}\"").as_str());
    BEARER.replace_all(&s, format!("Bearer {MASK}").as_str()).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_password_in_uri() {
        let out = redact_uri("mongodb://admin:s3cr3t@db.example.com:27017/app?tls=true");
        assert_eq!(out, "mongodb://admin:****@db.example.com:27017/app?tls=true");
        assert!(!out.contains("s3cr3t"));
        // An unencoded '@' inside the password must not leak its tail.
        assert_eq!(redact_uri("mongodb://u:p@ss@host/db"), "mongodb://u:****@host/db");
    }

    #[test]
    fn redacts_srv_uri_and_query_password() {
        let out = redact_uri("mongodb+srv://u:pw1@cluster0.x.mongodb.net/?proxyPassword=pw2&password=pw3&retryWrites=true");
        assert_eq!(out, "mongodb+srv://u:****@cluster0.x.mongodb.net/?proxyPassword=****&password=****&retryWrites=true");
    }

    #[test]
    fn leaves_uri_without_credentials_untouched() {
        for s in ["mongodb://localhost:27017", "mongodb://user@host/db", "mongodb+srv://c.x.net/?retryWrites=true", "plain text"] {
            assert_eq!(redact_uri(s), s);
        }
    }

    #[test]
    fn redacts_aws_session_token_property_but_not_other_mechanism_properties() {
        let out = redact_uri("mongodb+srv://h/?authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:abc123XYZ&tls=true");
        assert_eq!(out, "mongodb+srv://h/?authMechanism=MONGODB-AWS&authMechanismProperties=AWS_SESSION_TOKEN:****&tls=true");
        let kerberos = "mongodb://h/?authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:mongodb,CANONICALIZE_HOST_NAME:true";
        assert_eq!(redact_uri(kerberos), kerberos);
    }

    #[test]
    fn redacts_api_and_access_keys_in_options_and_json() {
        let out = redact_text(r#"?apiKey=k1&access_key=k2&secretKey=k3&clientSecret=k4 {"apiKey": "k5", "accessKey":"k6", "clientSecret": "k7"}"#);
        assert!(["k1", "k2", "k3", "k4", "k5", "k6", "k7"].iter().all(|k| !out.contains(k)), "{out}");
        assert_eq!(redact_text("name=value&retryWrites=true"), "name=value&retryWrites=true");
    }

    #[test]
    fn redact_text_masks_uris_json_fields_and_bearer_tokens() {
        let out = redact_text(
            r#"connect mongodb://a:b@h failed; body {"password": "hunter2", "token":"abc"}; Authorization: Bearer eyJ.abc-d_e="#,
        );
        assert_eq!(
            out,
            r#"connect mongodb://a:****@h failed; body {"password": "****", "token":"****"}; Authorization: Bearer ****"#
        );
    }

    #[test]
    fn redacts_proxy_password_in_uri_and_free_text() {
        let uri = "mongodb://h/?proxyHost=p&proxyUsername=u&proxyPassword=pr0xy";
        assert_eq!(redact_uri(uri), "mongodb://h/?proxyHost=p&proxyUsername=u&proxyPassword=****");
        assert!(!redact_text(&format!("failed: {uri}")).contains("pr0xy"));
        assert!(!redact_text(r#"{"proxyPassword": "pr0xy"}"#).contains("pr0xy"));
    }

    #[test]
    fn redacts_oidc_token_fields_in_json_and_forms() {
        let body = r#"{"access_token":"AT.secret","refresh_token": "RT-secret","id_token":"ID.secret","expires_in":3600}"#;
        let out = redact_text(body);
        assert!(["AT.secret", "RT-secret", "ID.secret"].iter().all(|t| !out.contains(t)), "{out}");
        assert!(out.contains("3600"), "non-secret fields stay: {out}");
        let form = redact_text("grant_type=refresh_token&refresh_token=RT-secret&client_id=abc&code_verifier=v&access_token=AT.secret");
        assert!(!form.contains("RT-secret") && !form.contains("AT.secret"), "{form}");
        assert!(form.contains("client_id=abc"), "{form}");
        assert!(!redact_text("Authorization: Bearer AT.secret").contains("AT.secret"));
    }

    #[test]
    fn redacts_atlas_service_account_secrets_and_tokens() {
        let out = redact_text(
            r#"POST grant_type=client_credentials&client_id=mdb_sa_id_1&client_secret=sA-9f8e Authorization: Bearer eyJhbGciOi.abc-DEF {"client_secret": "sA-9f8e", "access_token": "eyJhbGciOi.abc"}"#,
        );
        assert!(!out.contains("sA-9f8e") && !out.contains("eyJhbGciOi"), "{out}");
        assert!(out.contains("client_id=mdb_sa_id_1"), "the client id is not a secret: {out}");
    }

    #[test]
    fn redacts_every_csfle_credential_field() {
        let blob = r#"{"localMasterKey":"QUJD","aws":{"accessKeyId":"AKIA1","secretAccessKey":"sek","sessionToken":"tok"},"azure":{"tenantId":"t","clientId":"c","clientSecret":"azsec"},"gcp":{"email":"sa@x","privateKey":"PKEY"},"kmip":{"endpoint":"h:1","certPassword":"pw"}}"#;
        let out = redact_text(blob);
        for leaked in ["QUJD", "sek", "tok", "azsec", "PKEY", "\"pw\""] {
            assert!(!out.contains(leaked), "{leaked} leaked: {out}");
        }
        // Non-secret identifiers stay readable for diagnosis.
        assert!(out.contains("sa@x") && out.contains("h:1"));
    }
}
