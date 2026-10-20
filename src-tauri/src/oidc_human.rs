//! MONGODB-OIDC "workforce" (human) flow: authorization code + PKCE through the system browser.
//!
//! The driver calls our `Callback::human` with the IdP settings the server advertised
//! (`issuer`, `client_id`, `request_scopes`). We read the issuer's discovery document, open the
//! authorization URL in the browser, receive the redirect on `http://localhost:27097/redirect`
//! (the port the MongoDB tools use), exchange the code for tokens and hand the access token back.
//! The refresh token is kept per saved connection (`TokenPersist`) so later connects need no browser.
//!
//! Nothing here logs a token, an authorization code or a PKCE verifier.
use crate::mcp::http::{self, ReadError};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use futures::FutureExt;
use mongodb::error::Error as MongoError;
use mongodb::options::oidc::{Callback, CallbackContext, IdpServerResponse};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

/// Redirect port used by the MongoDB tools (mongosh, Compass), so an IdP application registered for
/// them already allows `http://localhost:27097/redirect`.
pub const REDIRECT_PORT: u16 = 27097;
/// How long the user gets to finish signing in.
pub const FLOW_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// A browser connection that sends nothing must not hold up the real redirect.
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// Opens a URL in the user's browser. Injectable so tests can play the browser.
pub type OpenBrowser = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Where the refresh token of one connection is kept between runs.
pub trait TokenPersist: Send + Sync {
    fn load(&self) -> Option<String>;
    fn save(&self, token: &str);
    fn forget(&self);
}

// ---- PKCE -----------------------------------------------------------------------------------

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// `BASE64URL(SHA256(verifier))` without padding (RFC 7636, method S256).
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random_token() -> Result<String, String> {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).map_err(|_| "no source of randomness".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

impl Pkce {
    /// A fresh 43-character verifier (256 random bits) and its S256 challenge.
    pub fn generate() -> Result<Pkce, String> {
        let verifier = random_token()?;
        let challenge = challenge_for(&verifier);
        Ok(Pkce { verifier, challenge })
    }
}

// ---- Redirect -------------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum RedirectError {
    /// Not `GET /redirect`: favicon, a probe, a different method.
    NotRedirect,
    /// The `state` is missing or not ours (CSRF / a stray tab): the request is ignored.
    WrongState,
    /// The IdP sent the user back with an error (access denied, ...).
    Provider(String),
    MissingCode,
}

/// Keeps provider-supplied text short and printable before it reaches a message.
fn tidy(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(200).collect()
}

/// The authorization code of a redirect request, after checking method, path and `state`.
/// `state` is compared first so that an attacker who does not know it cannot even inject an error.
pub fn parse_redirect(method: &str, target: &str, expected_state: &str) -> Result<String, RedirectError> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if method != "GET" || path != "/redirect" {
        return Err(RedirectError::NotRedirect);
    }
    let (mut state, mut code, mut error, mut description) = (None, None, None, None);
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "state" => state = Some(v.into_owned()),
            "code" => code = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            "error_description" => description = Some(v.into_owned()),
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Err(RedirectError::WrongState);
    }
    if let Some(e) = error {
        let detail = description.map(|d| format!(": {}", tidy(&d))).unwrap_or_default();
        return Err(RedirectError::Provider(format!("{}{detail}", tidy(&e))));
    }
    code.filter(|c| !c.is_empty()).ok_or(RedirectError::MissingCode)
}

const PAGE_OK: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>LumioNG</title></head><body style=\"font-family:sans-serif;margin:3em\"><h2>Signed in</h2><p>You can close this tab and return to LumioNG.</p></body></html>";
const PAGE_BAD: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>LumioNG</title></head><body style=\"font-family:sans-serif;margin:3em\"><h2>Sign-in failed</h2><p>Return to LumioNG for details.</p></body></html>";

/// Static page, no script; the headers keep the code in the URL from leaking and forbid any script anyway.
fn page(status: u16, body: &str) -> Vec<u8> {
    http::response(
        status,
        Some("text/html; charset=utf-8"),
        body.as_bytes(),
        &[
            ("Cache-Control", "no-store"),
            ("Referrer-Policy", "no-referrer"),
            ("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'"),
            ("X-Content-Type-Options", "nosniff"),
        ],
    )
}

async fn reply(stream: &mut tokio::net::TcpStream, bytes: Vec<u8>) {
    let _ = stream.write_all(&bytes).await;
    let _ = stream.shutdown().await;
}

/// Serves the loopback listener until the right redirect arrives, the IdP reports an error, or the deadline passes.
async fn wait_for_code(listener: &TcpListener, state: &str, deadline: Instant) -> Result<String, String> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let accepted = tokio::time::timeout(remaining, listener.accept()).await;
        let Ok(Ok((mut stream, _))) = accepted else {
            return Err(match accepted {
                Err(_) => "sign-in timed out: no redirect arrived from the browser".to_string(),
                Ok(Err(e)) => format!("could not accept the browser redirect: {e}"),
                Ok(Ok(_)) => unreachable!(),
            });
        };
        // A silent pre-connected socket must not push the whole wait past its deadline.
        let read_cap = READ_TIMEOUT.min(deadline.saturating_duration_since(Instant::now()));
        let req = match tokio::time::timeout(read_cap, http::read_request(&mut stream)).await {
            Ok(Ok(r)) => r,
            Ok(Err(ReadError::Bad(status, _))) => {
                reply(&mut stream, page(status, PAGE_BAD)).await;
                continue;
            }
            _ => continue,
        };
        match parse_redirect(&req.method, &req.path, state) {
            Ok(code) => {
                reply(&mut stream, page(200, PAGE_OK)).await;
                return Ok(code);
            }
            Err(RedirectError::NotRedirect) => reply(&mut stream, page(404, PAGE_BAD)).await,
            Err(RedirectError::WrongState) => {
                tracing::warn!("OIDC redirect ignored: state does not match");
                reply(&mut stream, page(400, PAGE_BAD)).await;
            }
            Err(RedirectError::MissingCode) => {
                reply(&mut stream, page(400, PAGE_BAD)).await;
                return Err("the identity provider redirected without an authorization code".into());
            }
            Err(RedirectError::Provider(msg)) => {
                reply(&mut stream, page(400, PAGE_BAD)).await;
                return Err(format!("the identity provider refused the sign-in ({msg})"));
            }
        }
    }
}

// ---- Tokens ---------------------------------------------------------------------------------

#[derive(Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in_secs: Option<u64>,
}

impl std::fmt::Debug for TokenResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenResponse")
            .field("access_token", &"****")
            .field("refresh_token", &self.refresh_token.as_ref().map(|_| "****"))
            .field("expires_in_secs", &self.expires_in_secs)
            .finish()
    }
}

impl TokenResponse {
    pub fn expires_at(&self, now: Instant) -> Option<Instant> {
        self.expires_in_secs.map(|s| now + Duration::from_secs(s))
    }
}

#[derive(Deserialize)]
struct RawToken {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<serde_json::Value>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Parses a token endpoint reply. An error reply yields only the provider's `error` and
/// `error_description`, never the body (which may hold tokens).
#[cfg(test)]
pub fn parse_token_response(body: &str) -> Result<TokenResponse, String> {
    parse_token_body(body).map_err(|(_, msg)| msg)
}

/// Like `parse_token_response`, but an error reply also yields the provider's error code.
fn parse_token_body(body: &str) -> Result<TokenResponse, (Option<String>, String)> {
    let raw: RawToken = serde_json::from_str(body).map_err(|_| (None, "the token endpoint did not return JSON".to_string()))?;
    if let Some(e) = raw.error {
        let detail = raw.error_description.map(|d| format!(": {}", tidy(&d))).unwrap_or_default();
        let msg = format!("the token endpoint returned {}{detail}", tidy(&e));
        return Err((Some(e), msg));
    }
    let access_token = raw.access_token.filter(|t| !t.is_empty()).ok_or((None, "the token endpoint returned no access_token".to_string()))?;
    let expires_in_secs = match raw.expires_in {
        Some(serde_json::Value::Number(n)) => n.as_u64(),
        Some(serde_json::Value::String(s)) => s.trim().parse().ok(),
        _ => None,
    };
    Ok(TokenResponse { access_token, refresh_token: raw.refresh_token.filter(|t| !t.is_empty()), expires_in_secs })
}

// ---- Discovery and URLs ---------------------------------------------------------------------

#[derive(Deserialize, Debug)]
pub struct Discovery {
    issuer: Option<String>,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
}

/// https always; plain http only to the machine itself (a local dev IdP).
fn secure_enough(u: &url::Url) -> bool {
    match u.scheme() {
        "https" => true,
        "http" => matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

fn checked_url(what: &str, s: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(s).map_err(|_| format!("the {what} is not a valid URL"))?;
    if secure_enough(&u) { Ok(u) } else { Err(format!("the {what} must use https")) }
}

pub async fn discover(http: &reqwest::Client, issuer: &str) -> Result<Discovery, String> {
    let base = checked_url("issuer", issuer)?;
    let url = format!("{}/.well-known/openid-configuration", base.as_str().trim_end_matches('/'));
    let resp = http.get(&url).send().await.map_err(|e| format!("could not reach the identity provider: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("the identity provider's discovery document returned HTTP {}", resp.status().as_u16()));
    }
    let d: Discovery = resp.json().await.map_err(|_| "the identity provider's discovery document is not valid".to_string())?;
    // A document that names no issuer, or another one, cannot vouch for these endpoints.
    if !d.issuer.as_deref().is_some_and(|i| same_issuer(i, issuer)) {
        return Err("the discovery document does not name the expected issuer".into());
    }
    checked_url("authorization endpoint", &d.authorization_endpoint)?;
    checked_url("token endpoint", &d.token_endpoint)?;
    Ok(d)
}

/// `request_scopes` plus what the flow itself needs (`openid`, and `offline_access` for a refresh token).
pub fn scopes(requested: &[String]) -> String {
    let mut out: Vec<&str> = Vec::new();
    for s in requested.iter().map(String::as_str).chain(["openid", "offline_access"]) {
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    out.join(" ")
}

pub fn authorization_url(
    d: &Discovery,
    client_id: &str,
    scope: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
    login_hint: Option<&str>,
) -> Result<String, String> {
    let mut u = checked_url("authorization endpoint", &d.authorization_endpoint)?;
    {
        let mut q = u.query_pairs_mut();
        q.append_pair("response_type", "code")
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("scope", scope)
            .append_pair("state", state)
            .append_pair("code_challenge", challenge)
            .append_pair("code_challenge_method", "S256");
        if let Some(h) = login_hint.filter(|h| !h.is_empty()) {
            q.append_pair("login_hint", h);
        }
    }
    Ok(u.into())
}

/// Why a token request failed. Only `Rejected` means the grant itself is dead.
#[derive(Debug, PartialEq)]
pub enum TokenFail {
    /// The token endpoint said the grant / token is invalid, revoked or not allowed (`invalid_grant`).
    Rejected(String),
    /// Network trouble, HTTP 5xx, throttling, an unreadable reply: the token may well still be good.
    Transient(String),
}

impl TokenFail {
    fn message(self) -> String {
        match self {
            TokenFail::Rejected(m) | TokenFail::Transient(m) => m,
        }
    }
}

async fn token_request(http: &reqwest::Client, endpoint: &str, form: &[(&str, &str)]) -> Result<TokenResponse, TokenFail> {
    let resp = http
        .post(endpoint)
        .form(form)
        .send()
        .await
        .map_err(|e| TokenFail::Transient(format!("could not reach the token endpoint: {}", e.without_url())))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|_| TokenFail::Transient("the token endpoint reply could not be read".to_string()))?;
    match parse_token_body(&body) {
        Ok(t) => Ok(t),
        Err((Some(code), msg)) if code == "invalid_grant" => Err(TokenFail::Rejected(msg)),
        Err((Some(_), msg)) => Err(TokenFail::Transient(msg)),
        Err((None, msg)) if status.is_success() => Err(TokenFail::Transient(msg)),
        Err((None, _)) => Err(TokenFail::Transient(format!("the token endpoint returned HTTP {}", status.as_u16()))),
    }
}

// ---- Binding a stored refresh token to its identity provider -------------------------------------

#[derive(serde::Serialize, Deserialize)]
struct Bound {
    v: u8,
    issuer: String,
    client_id: String,
    token: String,
}

fn same_issuer(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

/// What gets stored: the token together with the `(issuer, client_id)` it was issued for.
pub fn bind_token(issuer: &str, client_id: &str, token: &str) -> String {
    serde_json::to_string(&Bound { v: 1, issuer: issuer.trim_end_matches('/').into(), client_id: client_id.into(), token: token.into() }).unwrap_or_default()
}

/// The token inside `raw` if it was issued for exactly this issuer and client; `None` for another
/// identity provider, and for the old unbound format (a bare token string).
pub fn unbind_token(raw: &str, issuer: &str, client_id: &str) -> Option<String> {
    let b: Bound = serde_json::from_str(raw).ok()?;
    (b.v == 1 && same_issuer(&b.issuer, issuer) && b.client_id == client_id && !b.token.is_empty()).then_some(b.token)
}

// ---- The flow -------------------------------------------------------------------------------

pub struct HumanFlow {
    pub http: reqwest::Client,
    pub open_browser: OpenBrowser,
    /// Loopback address to listen on; production uses 127.0.0.1:27097.
    pub bind: SocketAddr,
    pub timeout: Duration,
    pub tokens: Option<Arc<dyn TokenPersist>>,
    /// The connection's user name, offered to the IdP as `login_hint`.
    pub login_hint: Option<String>,
    /// `(issuer, client_id, refresh token)` this flow itself received from the IdP, so the driver's
    /// cached copy can be recognised. The driver's token has no issuer attached and is never trusted alone.
    issued: std::sync::Mutex<Option<(String, String, String)>>,
}

impl HumanFlow {
    pub fn new(http: reqwest::Client, open_browser: OpenBrowser, tokens: Option<Arc<dyn TokenPersist>>, login_hint: Option<String>) -> Self {
        HumanFlow { http, open_browser, bind: SocketAddr::from(([127, 0, 0, 1], REDIRECT_PORT)), timeout: FLOW_TIMEOUT, tokens, login_hint, issued: Default::default() }
    }

    /// The driver callback for this flow.
    pub fn into_callback(self) -> Callback {
        let flow = Arc::new(self);
        Callback::human(move |ctx: CallbackContext| {
            let flow = flow.clone();
            async move {
                match flow.run(ctx).await {
                    Ok(r) => Ok(r),
                    Err(msg) => {
                        tracing::warn!("OIDC sign-in failed: {msg}");
                        Err(MongoError::custom(format!("OIDC sign-in failed: {msg}")))
                    }
                }
            }
            .boxed()
        })
    }

    pub async fn run(&self, ctx: CallbackContext) -> Result<IdpServerResponse, String> {
        let idp = ctx.idp_info.ok_or("the server sent no identity provider settings")?;
        let client_id = idp.client_id.filter(|c| !c.is_empty()).ok_or("the server's identity provider settings have no client id")?;
        let scope = scopes(idp.request_scopes.as_deref().unwrap_or(&[]));
        let mut deadline = Instant::now() + self.timeout;
        if let Some(t) = ctx.timeout {
            deadline = deadline.min(t);
        }
        let discovery = discover(&self.http, &idp.issuer).await?;

        // A refresh token (the driver's, else the stored one) avoids opening the browser at all. The
        // stored one is only used for the identity provider and client it was issued for.
        let stored = self.tokens.as_ref().and_then(|t| t.load()).and_then(|raw| {
            let usable = unbind_token(&raw, &idp.issuer, &client_id);
            if usable.is_none() {
                tracing::info!("stored OIDC refresh token belongs to another identity provider or has no binding; discarded");
                if let Some(t) = &self.tokens {
                    t.forget();
                }
            }
            usable
        });
        let remembered = self
            .issued
            .lock()
            .ok()
            .and_then(|g| g.as_ref().filter(|(i, c, _)| same_issuer(i, &idp.issuer) && *c == client_id).map(|(_, _, t)| t.clone()));
        // The driver's cached token is accepted only when it is the one we hold for THIS issuer and client.
        let refresh = match ctx.refresh_token {
            Some(d) if Some(&d) == stored.as_ref() || Some(&d) == remembered.as_ref() => Some(d),
            _ => stored.or(remembered),
        };
        if let Some(rt) = refresh {
            match token_request(
                &self.http,
                &discovery.token_endpoint,
                &[("grant_type", "refresh_token"), ("refresh_token", &rt), ("client_id", &client_id)],
            )
            .await
            {
                Ok(t) => return Ok(self.finish(t, Some(rt), &idp.issuer, &client_id)),
                Err(TokenFail::Rejected(e)) => {
                    tracing::info!("OIDC refresh token rejected, signing in again: {e}");
                    if let Some(t) = &self.tokens {
                        t.forget();
                    }
                }
                Err(TokenFail::Transient(e)) => tracing::info!("OIDC refresh failed, signing in again (token kept): {e}"),
            }
        }

        let tokens = self.sign_in(&discovery, &client_id, &scope, deadline).await?;
        Ok(self.finish(tokens, None, &idp.issuer, &client_id))
    }

    fn finish(&self, t: TokenResponse, previous_refresh: Option<String>, issuer: &str, client_id: &str) -> IdpServerResponse {
        // Providers may rotate the refresh token or omit it on refresh; keep the old one then.
        let refresh_token = t.refresh_token.clone().or(previous_refresh);
        if let Some(rt) = &refresh_token {
            if let Ok(mut g) = self.issued.lock() {
                *g = Some((issuer.to_string(), client_id.to_string(), rt.clone()));
            }
            if let Some(store) = &self.tokens {
                store.save(&bind_token(issuer, client_id, rt));
            }
        }
        IdpServerResponse::builder().access_token(t.access_token.clone()).expires(t.expires_at(Instant::now())).refresh_token(refresh_token).build()
    }

    async fn sign_in(&self, d: &Discovery, client_id: &str, scope: &str, deadline: Instant) -> Result<TokenResponse, String> {
        let listener = TcpListener::bind(self.bind).await.map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                format!("port {} is already in use. Close whatever is using it and try again. A previous sign-in that was abandoned can hold the port for up to 5 minutes", self.bind.port())
            } else {
                format!("could not listen on port {} for the browser redirect: {e}", self.bind.port())
            }
        })?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect_uri = format!("http://localhost:{port}/redirect");
        let pkce = Pkce::generate()?;
        let state = random_token()?;
        let url = authorization_url(d, client_id, scope, &redirect_uri, &state, &pkce.challenge, self.login_hint.as_deref())?;
        (self.open_browser)(&url).map_err(|e| format!("could not open the browser: {e}"))?;
        let code = wait_for_code(&listener, &state, deadline).await?;
        drop(listener);
        token_request(
            &self.http,
            &d.token_endpoint,
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", &redirect_uri),
                ("client_id", client_id),
                ("code_verifier", &pkce.verifier),
            ],
        )
        .await
        .map_err(TokenFail::message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn pkce_challenge_matches_verifier() {
        // RFC 7636 appendix B.
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let p = Pkce::generate().unwrap();
        assert_eq!(p.challenge, challenge_for(&p.verifier));
        assert_eq!(p.verifier.len(), 43);
        assert!(p.verifier.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(p.verifier, Pkce::generate().unwrap().verifier);
    }

    #[test]
    fn redirect_with_wrong_state_is_rejected() {
        assert_eq!(parse_redirect("GET", "/redirect?code=c&state=evil", "good"), Err(RedirectError::WrongState));
        assert_eq!(parse_redirect("GET", "/redirect?code=c", "good"), Err(RedirectError::WrongState));
        // An error from the provider cannot be injected without the state either.
        assert_eq!(parse_redirect("GET", "/redirect?error=access_denied&state=evil", "good"), Err(RedirectError::WrongState));
        assert_eq!(parse_redirect("GET", "/redirect?code=c1&state=good", "good"), Ok("c1".to_string()));
        assert_eq!(parse_redirect("POST", "/redirect?code=c&state=good", "good"), Err(RedirectError::NotRedirect));
        assert_eq!(parse_redirect("GET", "/other?code=c&state=good", "good"), Err(RedirectError::NotRedirect));
        assert_eq!(parse_redirect("GET", "/redirect?state=good", "good"), Err(RedirectError::MissingCode));
        assert!(matches!(parse_redirect("GET", "/redirect?error=access_denied&error_description=No+way&state=good", "good"), Err(RedirectError::Provider(m)) if m.contains("access_denied") && m.contains("No way")));
    }

    #[test]
    fn token_response_parses_expiry() {
        let t = parse_token_response(r#"{"access_token":"a1","token_type":"Bearer","expires_in":3600,"refresh_token":"r1"}"#).unwrap();
        assert_eq!((t.access_token.as_str(), t.refresh_token.as_deref(), t.expires_in_secs), ("a1", Some("r1"), Some(3600)));
        let now = Instant::now();
        assert_eq!(t.expires_at(now), Some(now + Duration::from_secs(3600)));
        // Some providers send the lifetime as a string, or not at all.
        assert_eq!(parse_token_response(r#"{"access_token":"a","expires_in":"120"}"#).unwrap().expires_in_secs, Some(120));
        let none = parse_token_response(r#"{"access_token":"a"}"#).unwrap();
        assert_eq!((none.expires_in_secs, none.refresh_token.clone(), none.expires_at(now)), (None, None, None));
        let err = parse_token_response(r#"{"error":"invalid_grant","error_description":"expired","access_token":""}"#).unwrap_err();
        assert!(err.contains("invalid_grant") && err.contains("expired"), "{err}");
        assert!(parse_token_response("not json").is_err());
        // Debug never prints a token.
        assert!(!format!("{t:?}").contains("a1") && !format!("{t:?}").contains("r1"));
    }

    #[test]
    fn scopes_add_openid_and_offline_access_once() {
        assert_eq!(scopes(&["api://x/.default".into(), "openid".into()]), "api://x/.default openid offline_access");
        assert_eq!(scopes(&[]), "openid offline_access");
    }

    #[test]
    fn authorization_url_carries_pkce_state_and_hint() {
        let d = Discovery { issuer: None, authorization_endpoint: "https://idp.example/authorize?tenant=t".into(), token_endpoint: "https://idp.example/token".into() };
        let u = authorization_url(&d, "cid", "openid", "http://localhost:27097/redirect", "st", "ch", Some("a@b.c")).unwrap();
        let u = url::Url::parse(&u).unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["tenant"], "t");
        assert_eq!((q["response_type"].as_str(), q["client_id"].as_str(), q["state"].as_str()), ("code", "cid", "st"));
        assert_eq!((q["code_challenge"].as_str(), q["code_challenge_method"].as_str()), ("ch", "S256"));
        assert_eq!((q["redirect_uri"].as_str(), q["login_hint"].as_str()), ("http://localhost:27097/redirect", "a@b.c"));
        let plain = Discovery { authorization_endpoint: "http://idp.example/authorize".into(), ..d };
        assert!(authorization_url(&plain, "c", "s", "r", "st", "ch", None).is_err());
    }

    // ---- a fake IdP and a fake browser ----

    #[derive(Default)]
    struct IdpLog {
        token_forms: Vec<std::collections::HashMap<String, String>>,
    }

    /// Discovery + token endpoint on 127.0.0.1. `/token` verifies PKCE against the challenge the
    /// "browser" saw, so a wrong verifier fails the exchange like a real IdP.
    async fn fake_idp(challenge: Arc<Mutex<Option<String>>>) -> (String, Arc<Mutex<IdpLog>>) {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        let log = Arc::new(Mutex::new(IdpLog::default()));
        let (b, lg) = (base.clone(), log.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { return };
                let (b, lg, challenge) = (b.clone(), lg.clone(), challenge.clone());
                tokio::spawn(async move {
                    let Ok(req) = http::read_request(&mut s).await else { return };
                    let json = "application/json";
                    let out = match (req.method.as_str(), req.path.as_str()) {
                        ("GET", "/.well-known/openid-configuration") => http::response(
                            200,
                            Some(json),
                            serde_json::json!({"issuer": b, "authorization_endpoint": format!("{b}/authorize"), "token_endpoint": format!("{b}/token")}).to_string().as_bytes(),
                            &[],
                        ),
                        ("POST", "/token") => {
                            let form: std::collections::HashMap<String, String> = url::form_urlencoded::parse(&req.body).into_owned().collect();
                            lg.lock().unwrap().token_forms.push(form.clone());
                            let ok = match form.get("grant_type").map(String::as_str) {
                                Some("authorization_code") => {
                                    form.get("code").map(String::as_str) == Some("the-code")
                                        && form.get("code_verifier").map(|v| challenge_for(v)) == *challenge.lock().unwrap()
                                        && form.get("redirect_uri").is_some_and(|r| r.starts_with("http://localhost:") && r.ends_with("/redirect"))
                                }
                                Some("refresh_token") => {
                                    if form.get("refresh_token").map(String::as_str) == Some("flaky") {
                                        let _ = s.write_all(&http::response(503, Some("text/plain"), b"try later", &[])).await;
                                        let _ = s.shutdown().await;
                                        return;
                                    }
                                    form.get("refresh_token").map(String::as_str) == Some("refresh-1")
                                }
                                _ => false,
                            };
                            if !ok {
                                http::response(400, Some(json), br#"{"error":"invalid_grant","error_description":"bad grant"}"#, &[])
                            } else if form["grant_type"] == "refresh_token" {
                                http::response(200, Some(json), br#"{"access_token":"access-2","expires_in":"600"}"#, &[])
                            } else {
                                http::response(200, Some(json), br#"{"access_token":"access-1","expires_in":3600,"refresh_token":"refresh-1","token_type":"Bearer"}"#, &[])
                            }
                        }
                        _ => http::response(404, None, b"", &[]),
                    };
                    let _ = s.write_all(&out).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        (base, log)
    }

    /// Plain GET against the loopback listener, returning the status code.
    async fn get(port: u16, target: &str) -> u16 {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes()).await.unwrap();
        let mut buf = String::new();
        s.read_to_string(&mut buf).await.unwrap();
        buf.split(' ').nth(1).unwrap().parse().unwrap()
    }

    #[derive(Default)]
    struct MemTokens(Mutex<Option<String>>);
    impl TokenPersist for MemTokens {
        fn load(&self) -> Option<String> { self.0.lock().unwrap().clone() }
        fn save(&self, t: &str) { *self.0.lock().unwrap() = Some(t.to_string()); }
        fn forget(&self) { *self.0.lock().unwrap() = None; }
    }

    fn stored(t: &MemTokens, issuer: &str) -> Option<String> {
        t.load().and_then(|raw| unbind_token(&raw, issuer, "client-1"))
    }

    fn ctx(base: &str, refresh: Option<&str>) -> CallbackContext {
        let idp = mongodb::options::oidc::IdpServerInfo::builder().issuer(base.to_string()).client_id(Some("client-1".to_string())).request_scopes(Some(vec!["api://db/.default".to_string()])).build();
        CallbackContext::builder().version(1u32).idp_info(Some(idp)).refresh_token(refresh.map(String::from)).build()
    }

    /// A "browser" that follows the authorization URL by hitting the redirect on the loopback
    /// listener: first with a wrong state (must be refused), then with the right one.
    fn fake_browser(challenge: Arc<Mutex<Option<String>>>, opened: Arc<Mutex<Vec<String>>>, wrong_state_first: bool) -> OpenBrowser {
        Arc::new(move |url: &str| {
            opened.lock().unwrap().push(url.to_string());
            let u = url::Url::parse(url).map_err(|e| e.to_string())?;
            let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
            *challenge.lock().unwrap() = Some(q["code_challenge"].clone());
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            let state = q["state"].clone();
            tokio::spawn(async move {
                if wrong_state_first {
                    assert_eq!(get(port, "/redirect?code=the-code&state=forged").await, 400);
                    assert_eq!(get(port, "/favicon.ico").await, 404);
                }
                assert_eq!(get(port, &format!("/redirect?code=the-code&state={state}")).await, 200);
            });
            Ok(())
        })
    }

    fn flow(open: OpenBrowser, tokens: Arc<MemTokens>) -> HumanFlow {
        let http = crate::http_client::build_no_redirect(None, Duration::from_secs(5)).unwrap();
        let mut f = HumanFlow::new(http, open, Some(tokens), Some("me@example.com".into()));
        f.bind = SocketAddr::from(([127, 0, 0, 1], 0));
        f.timeout = Duration::from_secs(10);
        f
    }

    #[tokio::test]
    async fn human_flow_end_to_end_with_a_fake_idp() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, log) = fake_idp(challenge.clone()).await;
        let opened = Arc::new(Mutex::new(Vec::new()));
        let tokens = Arc::new(MemTokens::default());
        let f = flow(fake_browser(challenge.clone(), opened.clone(), true), tokens.clone());

        let r = f.run(ctx(&base, None)).await.unwrap();
        assert_eq!(r.access_token, "access-1");
        assert_eq!(r.refresh_token.as_deref(), Some("refresh-1"));
        assert!(r.expires.is_some_and(|e| e > Instant::now() + Duration::from_secs(3000)));
        assert_eq!(stored(&tokens, &base), Some("refresh-1".into()), "refresh token persisted, bound to this issuer");

        let urls = opened.lock().unwrap();
        assert_eq!(urls.len(), 1);
        let q: std::collections::HashMap<_, _> = url::Url::parse(&urls[0]).unwrap().query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "client-1");
        assert_eq!(q["scope"], "api://db/.default openid offline_access");
        assert_eq!(q["login_hint"], "me@example.com");
        assert_eq!(log.lock().unwrap().token_forms.len(), 1, "forged redirect never reached the token endpoint");
    }

    #[tokio::test]
    async fn a_stored_refresh_token_skips_the_browser() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, log) = fake_idp(challenge).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save(&bind_token(&base, "client-1", "refresh-1"));
        let never: OpenBrowser = Arc::new(|_| Err("the browser must not open".into()));
        let r = flow(never, tokens.clone()).run(ctx(&base, None)).await.unwrap();
        assert_eq!(r.access_token, "access-2");
        assert_eq!(stored(&tokens, &base), Some("refresh-1".into()), "kept when the provider does not rotate it");
        assert_eq!(log.lock().unwrap().token_forms[0]["grant_type"], "refresh_token");
    }

    #[tokio::test]
    async fn a_rejected_refresh_token_falls_back_to_the_browser() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge.clone()).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save(&bind_token(&base, "client-1", "revoked"));
        let opened = Arc::new(Mutex::new(Vec::new()));
        let r = flow(fake_browser(challenge, opened.clone(), false), tokens.clone()).run(ctx(&base, None)).await.unwrap();
        assert_eq!(r.access_token, "access-1");
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert_eq!(stored(&tokens, &base), Some("refresh-1".into()));
    }

    #[tokio::test]
    async fn a_busy_port_is_reported_by_number() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge).await;
        let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut f = flow(Arc::new(|_| Ok(())), Arc::new(MemTokens::default()));
        f.bind = taken.local_addr().unwrap();
        let err = f.run(ctx(&base, None)).await.unwrap_err();
        assert!(err.contains(&taken.local_addr().unwrap().port().to_string()) && err.contains("already in use"), "{err}");
    }

    #[tokio::test]
    async fn no_redirect_before_the_deadline_times_out() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge).await;
        let mut f = flow(Arc::new(|_| Ok(())), Arc::new(MemTokens::default()));
        f.timeout = Duration::from_millis(300);
        let err = f.run(ctx(&base, None)).await.unwrap_err();
        assert!(err.contains("timed out"), "{err}");
    }

    #[tokio::test]
    async fn an_idp_error_redirect_aborts_with_its_reason() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge).await;
        let open: OpenBrowser = Arc::new(|url: &str| {
            let q: std::collections::HashMap<_, _> = url::Url::parse(url).unwrap().query_pairs().into_owned().collect();
            let port = url::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap();
            let state = q["state"].clone();
            tokio::spawn(async move { get(port, &format!("/redirect?error=access_denied&state={state}")).await });
            Ok(())
        });
        let err = flow(open, Arc::new(MemTokens::default())).run(ctx(&base, None)).await.unwrap_err();
        assert!(err.contains("access_denied"), "{err}");
    }

    #[tokio::test]
    async fn a_plain_http_issuer_on_the_internet_is_refused() {
        let http = crate::http_client::build_no_redirect(None, Duration::from_secs(2)).unwrap();
        let err = discover(&http, "http://idp.example.com").await.unwrap_err();
        assert!(err.contains("https"), "{err}");
    }

    #[test]
    fn a_stored_token_is_bound_to_issuer_and_client() {
        let raw = bind_token("https://idp.example/", "c1", "rt");
        assert_eq!(unbind_token(&raw, "https://idp.example", "c1").as_deref(), Some("rt"));
        assert_eq!(unbind_token(&raw, "https://evil.example", "c1"), None);
        assert_eq!(unbind_token(&raw, "https://idp.example", "c2"), None);
        // The old format was the bare token.
        assert_eq!(unbind_token("rt", "https://idp.example", "c1"), None);
    }

    #[tokio::test]
    async fn a_second_issuer_never_receives_the_first_issuers_refresh_token() {
        let challenge = Arc::new(Mutex::new(None));
        let (idp_a, _log_a) = fake_idp(challenge.clone()).await;
        let (idp_b, log_b) = fake_idp(challenge.clone()).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save(&bind_token(&idp_a, "client-1", "refresh-1"));
        let opened = Arc::new(Mutex::new(Vec::new()));
        // Same connection, but the server now advertises issuer B.
        let r = flow(fake_browser(challenge, opened.clone(), false), tokens.clone()).run(ctx(&idp_b, None)).await.unwrap();
        assert_eq!(r.access_token, "access-1");
        assert_eq!(opened.lock().unwrap().len(), 1, "browser flow ran");
        let forms = &log_b.lock().unwrap().token_forms;
        assert!(forms.iter().all(|f| f.get("refresh_token").is_none()), "issuer B saw a refresh token: {forms:?}");
        assert_eq!(stored(&tokens, &idp_b), Some("refresh-1".into()));
        assert_eq!(stored(&tokens, &idp_a), None, "rebound to B");
    }

    #[tokio::test]
    async fn a_token_stored_in_the_old_unbound_format_is_discarded() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, log) = fake_idp(challenge.clone()).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save("refresh-1");
        let opened = Arc::new(Mutex::new(Vec::new()));
        flow(fake_browser(challenge, opened.clone(), false), tokens.clone()).run(ctx(&base, None)).await.unwrap();
        assert_eq!(opened.lock().unwrap().len(), 1);
        assert!(log.lock().unwrap().token_forms.iter().all(|f| f["grant_type"] == "authorization_code"));
    }

    #[tokio::test]
    async fn a_transient_refresh_failure_keeps_the_stored_token() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save(&bind_token(&base, "client-1", "flaky"));
        let no_browser: OpenBrowser = Arc::new(|_| Err("no browser".into()));
        assert!(flow(no_browser, tokens.clone()).run(ctx(&base, None)).await.is_err());
        assert_eq!(stored(&tokens, &base), Some("flaky".into()), "a 503 must not cost the user their session");
    }

    #[tokio::test]
    async fn a_rejected_refresh_token_is_forgotten() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, _log) = fake_idp(challenge).await;
        let tokens = Arc::new(MemTokens::default());
        tokens.save(&bind_token(&base, "client-1", "revoked"));
        let no_browser: OpenBrowser = Arc::new(|_| Err("no browser".into()));
        assert!(flow(no_browser, tokens.clone()).run(ctx(&base, None)).await.is_err());
        assert_eq!(tokens.load(), None);
    }

    /// One-connection servers that answer every request with `reply`.
    async fn canned_server(reply: String) -> String {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else { return };
                let reply = reply.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf).await;
                    let _ = s.write_all(reply.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        base
    }

    #[tokio::test]
    async fn discovery_without_an_issuer_or_with_another_is_refused() {
        let http = crate::http_client::build_no_redirect(None, Duration::from_secs(2)).unwrap();
        let doc = |body: &str| format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let none = canned_server(doc(r#"{"authorization_endpoint":"http://127.0.0.1/a","token_endpoint":"http://127.0.0.1/t"}"#)).await;
        assert!(discover(&http, &none).await.unwrap_err().contains("issuer"));
        let other = canned_server(doc(r#"{"issuer":"http://evil.example","authorization_endpoint":"http://127.0.0.1/a","token_endpoint":"http://127.0.0.1/t"}"#)).await;
        assert!(discover(&http, &other).await.unwrap_err().contains("issuer"));
    }

    #[tokio::test]
    async fn discovery_does_not_follow_a_redirect() {
        let http = crate::http_client::build_no_redirect(None, Duration::from_secs(2)).unwrap();
        let base = canned_server("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:9/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
        assert!(discover(&http, &base).await.unwrap_err().contains("HTTP 307"));
    }

    #[tokio::test]
    async fn a_silent_connection_cannot_push_the_wait_past_the_deadline() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let _silent = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap(); // connects, sends nothing
        let started = Instant::now();
        let err = wait_for_code(&l, "st", Instant::now() + Duration::from_millis(400)).await.unwrap_err();
        assert!(err.contains("timed out"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(3), "waited {:?}", started.elapsed());
    }

    #[tokio::test]
    async fn the_drivers_cached_token_for_another_issuer_is_never_sent() {
        let challenge = Arc::new(Mutex::new(None));
        let (idp_a, _la) = fake_idp(challenge.clone()).await;
        let (idp_b, log_b) = fake_idp(challenge.clone()).await;
        let opened = Arc::new(Mutex::new(Vec::new()));
        let tokens = Arc::new(MemTokens::default());
        let f = flow(fake_browser(challenge, opened.clone(), false), tokens.clone());
        // Sign in at A: the flow remembers A's token (and the driver would cache it).
        let a = f.run(ctx(&idp_a, None)).await.unwrap();
        // Same flow object, same driver cache, but idp_info now names B.
        let b = f.run(ctx(&idp_b, a.refresh_token.as_deref())).await.unwrap();
        assert_eq!(opened.lock().unwrap().len(), 2, "B needed its own browser sign-in");
        assert!(log_b.lock().unwrap().token_forms.iter().all(|f| f.get("refresh_token").is_none()), "B received A's token");
        assert_eq!(stored(&tokens, &idp_a), None);
        assert_eq!(stored(&tokens, &idp_b), b.refresh_token, "only a token B issued is bound to B");
    }

    #[tokio::test]
    async fn an_arbitrary_driver_token_is_not_sent_or_saved() {
        let challenge = Arc::new(Mutex::new(None));
        let (base, log) = fake_idp(challenge.clone()).await;
        let tokens = Arc::new(MemTokens::default());
        let opened = Arc::new(Mutex::new(Vec::new()));
        flow(fake_browser(challenge, opened.clone(), false), tokens.clone()).run(ctx(&base, Some("foreign"))).await.unwrap();
        assert!(log.lock().unwrap().token_forms.iter().all(|f| f.get("refresh_token").is_none()));
        assert_eq!(stored(&tokens, &base), Some("refresh-1".into()));
    }
}
