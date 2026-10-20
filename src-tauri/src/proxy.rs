//! Proxy settings shared by every outbound client (the Mongo driver today; OIDC and the Atlas API
//! later). Plain data plus URL building; the actual HTTP CONNECT tunnel is in `http_proxy_tunnel.rs`.
use serde::Deserialize;

/// `kind` is "socks5" or "http". The password is plaintext here (decoded by the frontend just for
/// this call) and is never printed: `Debug` masks it.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyConfig {
    pub kind: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

impl std::fmt::Debug for ProxyConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProxyConfig")
            .field("kind", &self.kind)
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("password", &if self.password.is_empty() { "" } else { "****" })
            .finish()
    }
}

impl ProxyConfig {
    pub fn is_http(&self) -> bool {
        self.kind == "http"
    }
    pub fn is_socks5(&self) -> bool {
        self.kind == "socks5"
    }
    /// `host:port` with no credentials (safe to show).
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
    /// A proxy URL for HTTP client libraries (`socks5h://` resolves names at the proxy). Contains
    /// the credentials, so never log it.
    pub fn url(&self) -> String {
        let scheme = if self.is_socks5() { "socks5h" } else { "http" };
        let enc = |s: &str| s.bytes().map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        }).collect::<String>();
        let auth = match (self.user.is_empty(), self.password.is_empty()) {
            (true, _) => String::new(),
            (false, true) => format!("{}@", enc(&self.user)),
            (false, false) => format!("{}:{}@", enc(&self.user), enc(&self.password)),
        };
        format!("{scheme}://{auth}{}:{}", self.host, self.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(kind: &str) -> ProxyConfig {
        ProxyConfig { kind: kind.into(), host: "p.local".into(), port: 3128, user: "u".into(), password: "p@ss".into() }
    }

    #[test]
    fn url_encodes_credentials_and_picks_the_scheme() {
        assert_eq!(cfg("http").url(), "http://u:p%40ss@p.local:3128");
        assert_eq!(cfg("socks5").url(), "socks5h://u:p%40ss@p.local:3128");
        assert_eq!(ProxyConfig { user: String::new(), ..cfg("http") }.url(), "http://p.local:3128");
    }

    #[test]
    fn debug_never_shows_the_password() {
        assert!(!format!("{:?}", cfg("http")).contains("p@ss"));
    }

    #[test]
    fn deserializes_with_defaults() {
        let c: ProxyConfig = serde_json::from_str(r#"{"kind":"http","host":"h","port":8080}"#).unwrap();
        assert!(c.is_http() && c.user.is_empty() && c.endpoint() == "h:8080");
    }
}
