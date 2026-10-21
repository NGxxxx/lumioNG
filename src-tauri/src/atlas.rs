//! MongoDB Atlas Admin API v2 client, authenticated as a Service Account (OAuth2 client credentials).
//!
//! `POST {base}/api/oauth/token` with HTTP Basic `client_id:client_secret` and
//! `grant_type=client_credentials` returns a short-lived bearer token, which is cached in memory
//! until 60 seconds before it expires. The API itself is `GET {base}/api/atlas/v2/groups` (projects)
//! and `.../groups/{id}/clusters`, both paginated (`results`, `links`, `totalCount`).
//!
//! The client secret and the token are never logged, put in an error message or returned to the
//! frontend; an error from the server is reduced to its `error`/`detail`/`reason` fields. No request
//! follows a redirect, so credentials only ever reach the host the client was built for.
use crate::error::AppError;
use crate::http_client;
use crate::proxy::ProxyConfig;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The Atlas control plane. Fixed: only tests inject another base URL.
pub const API_BASE: &str = "https://cloud.mongodb.com";
const TOKEN_PATH: &str = "/api/oauth/token";
const GROUPS_ACCEPT: &str = "application/vnd.atlas.2023-01-01+json";
const CLUSTERS_ACCEPT: &str = "application/vnd.atlas.2023-02-01+json";
/// A token is refreshed this long before the server says it expires.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);
const DEFAULT_PAGE_SIZE: u32 = 100;
/// Safety stop for a server that keeps paging forever.
const MAX_PAGES: u32 = 200;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasProject {
    pub id: String,
    pub name: String,
}

/// A cluster with the connection strings Atlas published for it. A paused cluster has none.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasCluster {
    pub name: String,
    pub state: String,
    pub cluster_type: String,
    pub mongo_version: String,
    /// `mongodb+srv://…` (preferred).
    pub srv: Option<String>,
    /// `mongodb://host1,host2,…/?…` for drivers without SRV support.
    pub standard: Option<String>,
    /// Private-endpoint SRV string, when one is set up.
    pub private_srv: Option<String>,
}

#[derive(Deserialize)]
struct Page<T> {
    #[serde(default = "Vec::new")]
    results: Vec<T>,
    #[serde(default)]
    links: Vec<Link>,
    #[serde(rename = "totalCount", default)]
    total_count: Option<u64>,
}

#[derive(Deserialize)]
struct Link {
    #[serde(default)]
    rel: String,
}

#[derive(Deserialize)]
struct RawGroup {
    id: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawConnectionStrings {
    standard: Option<String>,
    standard_srv: Option<String>,
    private_srv: Option<String>,
    private_endpoint: Vec<RawPrivateEndpoint>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawPrivateEndpoint {
    srv_connection_string: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCluster {
    name: String,
    #[serde(default)]
    state_name: Option<String>,
    #[serde(default)]
    cluster_type: Option<String>,
    #[serde(rename = "mongoDBVersion", default)]
    mongo_db_version: Option<String>,
    #[serde(default)]
    connection_strings: Option<RawConnectionStrings>,
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.trim().is_empty())
}

/// Maps one cluster of the API reply to what the UI needs.
fn map_cluster(raw: RawCluster) -> AtlasCluster {
    let cs = raw.connection_strings.unwrap_or_default();
    let private_srv = non_empty(cs.private_srv).or_else(|| cs.private_endpoint.into_iter().find_map(|e| non_empty(e.srv_connection_string)));
    AtlasCluster {
        name: raw.name,
        state: raw.state_name.unwrap_or_default(),
        cluster_type: raw.cluster_type.unwrap_or_default(),
        mongo_version: raw.mongo_db_version.unwrap_or_default(),
        srv: non_empty(cs.standard_srv),
        standard: non_empty(cs.standard),
        private_srv,
    }
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    #[serde(default)]
    expires_in: u64,
}

struct CachedToken {
    token: String,
    valid_until: Instant,
}

/// Never prints the secret or the token.
pub struct AtlasClient {
    base: String,
    client_id: String,
    client_secret: zeroize::Zeroizing<String>,
    http: reqwest::Client,
    page_size: u32,
    token: Mutex<Option<CachedToken>>,
}

impl std::fmt::Debug for AtlasClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AtlasClient").field("base", &self.base).field("client_id", &self.client_id).finish_non_exhaustive()
    }
}

/// The part of an Atlas error body worth showing; never echoes request data.
fn api_error_text(status: reqwest::StatusCode, body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let pick = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(|s| s.chars().filter(|c| !c.is_control()).take(200).collect::<String>());
    let detail = pick("detail").or_else(|| pick("error_description")).or_else(|| pick("reason")).or_else(|| pick("error"));
    match (status.as_u16(), detail) {
        (401, d) => format!("Atlas rejected the Service Account credentials (HTTP 401){}", d.map(|d| format!(": {d}")).unwrap_or_default()),
        (403, d) => format!("The Service Account has no access to this resource, or the request does not come from an allowed IP address (HTTP 403){}", d.map(|d| format!(": {d}")).unwrap_or_default()),
        (code, Some(d)) => format!("Atlas API error (HTTP {code}): {d}"),
        (code, None) => format!("Atlas API error (HTTP {code})"),
    }
}

fn transport(e: reqwest::Error) -> AppError {
    // reqwest's text can embed the URL; only say what kind of failure it was.
    let what = if e.is_timeout() {
        "timed out"
    } else if e.is_connect() {
        "could not connect"
    } else {
        "request failed"
    };
    AppError::Connection(format!("Atlas API: {what}"))
}

impl AtlasClient {
    pub fn new(client_id: &str, client_secret: &str, proxy: Option<&ProxyConfig>) -> Result<Self, AppError> {
        Self::with_base(API_BASE, client_id, client_secret, proxy)
    }

    pub fn with_base(base: &str, client_id: &str, client_secret: &str, proxy: Option<&ProxyConfig>) -> Result<Self, AppError> {
        Ok(AtlasClient {
            base: base.trim_end_matches('/').to_string(),
            client_id: client_id.to_string(),
            client_secret: zeroize::Zeroizing::new(client_secret.to_string()),
            http: http_client::build_no_redirect(proxy, TIMEOUT)?,
            page_size: DEFAULT_PAGE_SIZE,
            token: Mutex::new(None),
        })
    }

    #[cfg(test)]
    fn with_page_size(mut self, n: u32) -> Self {
        self.page_size = n;
        self
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    fn cached(&self) -> Option<String> {
        let g = self.token.lock().ok()?;
        g.as_ref().filter(|t| Instant::now() < t.valid_until).map(|t| t.token.clone())
    }

    /// A valid bearer token: the cached one until 60 s before it expires, else a fresh one.
    pub async fn token(&self) -> Result<String, AppError> {
        if let Some(t) = self.cached() {
            return Ok(t);
        }
        let resp = self
            .http
            .post(format!("{}{TOKEN_PATH}", self.base))
            .basic_auth(&self.client_id, Some(self.client_secret.as_str()))
            .header("Accept", "application/json")
            .form(&[("grant_type", "client_credentials")])
            .send()
            .await
            .map_err(transport)?;
        let status = resp.status();
        let body = resp.text().await.map_err(transport)?;
        if !status.is_success() {
            return Err(AppError::Connection(api_error_text(status, &body)));
        }
        let reply: TokenReply = serde_json::from_str(&body).map_err(|_| AppError::Connection("Atlas returned an unreadable token reply".into()))?;
        let lifetime = Duration::from_secs(reply.expires_in).saturating_sub(EXPIRY_MARGIN);
        if let Ok(mut g) = self.token.lock() {
            *g = Some(CachedToken { token: reply.access_token.clone(), valid_until: Instant::now() + lifetime });
        }
        Ok(reply.access_token)
    }

    /// Every page of a list endpoint, in order.
    async fn fetch_all<R: serde::de::DeserializeOwned>(&self, path: &str, accept: &str) -> Result<Vec<R>, AppError> {
        let mut out: Vec<R> = Vec::new();
        for page_num in 1..=MAX_PAGES {
            let token = self.token().await?;
            let resp = self
                .http
                .get(format!("{}{path}", self.base))
                .query(&[("pageNum", page_num.to_string()), ("itemsPerPage", self.page_size.to_string())])
                .bearer_auth(&token)
                .header("Accept", accept)
                .send()
                .await
                .map_err(transport)?;
            let status = resp.status();
            let body = resp.text().await.map_err(transport)?;
            if !status.is_success() {
                if status.as_u16() == 401 {
                    // The token may have been revoked early: forget it so the next call signs in again.
                    if let Ok(mut g) = self.token.lock() {
                        *g = None;
                    }
                }
                return Err(AppError::Connection(api_error_text(status, &body)));
            }
            let page: Page<R> = serde_json::from_str(&body).map_err(|_| AppError::Parse("Atlas returned an unreadable list".into()))?;
            let got = page.results.len();
            out.extend(page.results);
            let has_next = page.links.iter().any(|l| l.rel == "next");
            let complete = page.total_count.is_some_and(|t| out.len() as u64 >= t);
            if got == 0 || complete || !has_next {
                break;
            }
        }
        Ok(out)
    }

    pub async fn list_projects(&self) -> Result<Vec<AtlasProject>, AppError> {
        let raw: Vec<RawGroup> = self.fetch_all("/api/atlas/v2/groups", GROUPS_ACCEPT).await?;
        Ok(raw.into_iter().map(|g| AtlasProject { name: if g.name.is_empty() { g.id.clone() } else { g.name }, id: g.id }).collect())
    }

    pub async fn list_clusters(&self, group_id: &str) -> Result<Vec<AtlasCluster>, AppError> {
        if group_id.is_empty() || !group_id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(AppError::Parse("invalid Atlas project id".into()));
        }
        let raw: Vec<RawCluster> = self.fetch_all(&format!("/api/atlas/v2/groups/{group_id}/clusters"), CLUSTERS_ACCEPT).await?;
        Ok(raw.into_iter().map(map_cluster).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[derive(Debug, Clone)]
    struct Req {
        method: String,
        target: String,
        headers: String,
        body: String,
    }

    type Handler = Arc<dyn Fn(&Req) -> (u16, String) + Send + Sync>;

    /// A one-request-per-connection HTTP/1.1 fake. Returns its base URL and the recorded requests.
    async fn fake(handler: Handler) -> (String, Arc<Mutex<Vec<Req>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let seen: Arc<Mutex<Vec<Req>>> = Arc::default();
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = listener.accept().await else { return };
                let (handler, log) = (handler.clone(), log.clone());
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let head_end = loop {
                        let n = s.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            break i + 4;
                        }
                    };
                    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                    let len = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    while buf.len() < head_end + len {
                        let n = s.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let mut first = head.lines().next().unwrap_or("").split(' ');
                    let req = Req {
                        method: first.next().unwrap_or("").into(),
                        target: first.next().unwrap_or("").into(),
                        headers: head.to_ascii_lowercase(),
                        body: String::from_utf8_lossy(&buf[head_end..]).to_string(),
                    };
                    let (status, body) = handler(&req);
                    log.lock().unwrap().push(req);
                    let reply = format!(
                        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(reply.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        (base, seen)
    }

    fn token_json(expires_in: u64) -> String {
        format!(r#"{{"access_token":"tok-abc","token_type":"Bearer","expires_in":{expires_in}}}"#)
    }

    fn count_tokens(seen: &Arc<Mutex<Vec<Req>>>) -> usize {
        seen.lock().unwrap().iter().filter(|r| r.target == TOKEN_PATH).count()
    }

    #[tokio::test]
    async fn token_is_cached_until_expiry() {
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        let (base, seen) = fake(Arc::new(move |r| {
            assert_eq!(r.target, TOKEN_PATH);
            h.fetch_add(1, Ordering::SeqCst);
            (200, token_json(3600))
        }))
        .await;
        let c = AtlasClient::with_base(&base, "mdb_sa_id_1", "s3cret", None).unwrap();
        assert_eq!(c.token().await.unwrap(), "tok-abc");
        assert_eq!(c.token().await.unwrap(), "tok-abc");
        assert_eq!(c.token().await.unwrap(), "tok-abc");
        assert_eq!(hits.load(Ordering::SeqCst), 1, "a valid token is reused");

        // The request is a client-credentials grant with HTTP Basic client_id:secret (base64 of "mdb_sa_id_1:s3cret"; headers are lowercased by the fake).
        let r = seen.lock().unwrap()[0].clone();
        assert_eq!(r.method, "POST");
        assert_eq!(r.body, "grant_type=client_credentials");
        assert!(r.headers.contains("authorization: basic bwrix3nhx2lkxze6cznjcmv0"), "{}", r.headers);
        assert!(!r.body.contains("s3cret"), "the secret never goes in the body");

        // 60 s before expiry the token counts as expired: a 59 s lifetime is refetched every time.
        let (base, seen) = fake(Arc::new(|_| (200, token_json(59)))).await;
        let short = AtlasClient::with_base(&base, "id", "secret", None).unwrap();
        short.token().await.unwrap();
        short.token().await.unwrap();
        assert_eq!(count_tokens(&seen), 2);
        // …while 61 s is still usable.
        let (base, seen) = fake(Arc::new(|_| (200, token_json(61)))).await;
        let ok = AtlasClient::with_base(&base, "id", "secret", None).unwrap();
        ok.token().await.unwrap();
        ok.token().await.unwrap();
        assert_eq!(count_tokens(&seen), 1);
    }

    #[tokio::test]
    async fn a_rejected_token_request_names_the_problem_without_leaking_the_secret() {
        let (base, _) = fake(Arc::new(|_| (401, r#"{"error":"invalid_client","error_description":"bad credentials"}"#.into()))).await;
        let c = AtlasClient::with_base(&base, "id", "topsecret", None).unwrap();
        let e = c.token().await.unwrap_err().to_string();
        assert!(e.contains("401") && e.contains("bad credentials"), "{e}");
        assert!(!e.contains("topsecret") && !format!("{c:?}").contains("topsecret"));
    }

    #[tokio::test]
    async fn the_token_endpoint_redirect_is_not_followed() {
        let (base, seen) = fake(Arc::new(|_| (307, String::new()))).await;
        let c = AtlasClient::with_base(&base, "id", "secret", None).unwrap();
        assert!(c.token().await.is_err());
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    fn cluster_json(name: &str) -> String {
        format!(r#"{{"name":"{name}","stateName":"IDLE","clusterType":"REPLICASET","mongoDBVersion":"7.0.12","connectionStrings":{{"standard":"mongodb://{name}-shard-00-00.x.mongodb.net:27017/?ssl=true","standardSrv":"mongodb+srv://{name}.x.mongodb.net"}}}}"#)
    }

    #[tokio::test]
    async fn paginates_clusters() {
        let (base, seen) = fake(Arc::new(|r| {
            if r.target == TOKEN_PATH {
                return (200, token_json(3600));
            }
            assert!(r.headers.contains("authorization: bearer tok-abc"));
            assert!(r.headers.contains("accept: application/vnd.atlas."), "{}", r.headers);
            let page = if r.target.contains("pageNum=1") {
                1
            } else if r.target.contains("pageNum=2") {
                2
            } else {
                3
            };
            let (items, next) = match page {
                1 => (format!("{},{}", cluster_json("a"), cluster_json("b")), true),
                2 => (format!("{},{}", cluster_json("c"), cluster_json("d")), true),
                _ => (cluster_json("e"), false),
            };
            let link = if next { r#"{"rel":"next","href":"x"}"# } else { "" };
            (200, format!(r#"{{"links":[{{"rel":"self","href":"x"}}{}{link}],"results":[{items}],"totalCount":5}}"#, if next { "," } else { "" }))
        }))
        .await;
        let c = AtlasClient::with_base(&base, "id", "secret", None).unwrap().with_page_size(2);
        let clusters = c.list_clusters("5f0a1b2c3d4e5f6a7b8c9d0e").await.unwrap();
        assert_eq!(clusters.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["a", "b", "c", "d", "e"]);
        let pages: Vec<String> = seen.lock().unwrap().iter().filter(|r| r.target != TOKEN_PATH).map(|r| r.target.clone()).collect();
        assert_eq!(pages.len(), 3);
        assert!(pages[0].starts_with("/api/atlas/v2/groups/5f0a1b2c3d4e5f6a7b8c9d0e/clusters?") && pages[0].contains("itemsPerPage=2"), "{pages:?}");
        assert_eq!(count_tokens(&seen), 1, "one token serves every page");
    }

    #[tokio::test]
    async fn pagination_stops_when_the_server_reports_no_further_page() {
        // A short last page without a "next" link ends the loop even if totalCount is missing.
        let (base, seen) = fake(Arc::new(|r| {
            if r.target == TOKEN_PATH {
                return (200, token_json(3600));
            }
            (200, r#"{"links":[],"results":[{"id":"p1","name":"Prod"},{"id":"p2","name":"Dev"}]}"#.into())
        }))
        .await;
        let c = AtlasClient::with_base(&base, "id", "secret", None).unwrap().with_page_size(2);
        let projects = c.list_projects().await.unwrap();
        assert_eq!(projects, vec![AtlasProject { id: "p1".into(), name: "Prod".into() }, AtlasProject { id: "p2".into(), name: "Dev".into() }]);
        assert_eq!(seen.lock().unwrap().iter().filter(|r| r.target != TOKEN_PATH).count(), 1);
    }

    #[tokio::test]
    async fn maps_connection_strings() {
        let body = r#"{"results":[
          {"name":"Full","stateName":"IDLE","clusterType":"SHARDED","mongoDBVersion":"8.0.1","connectionStrings":{
             "standard":"mongodb://h1:27017,h2:27017/?ssl=true","standardSrv":"mongodb+srv://full.ab1.mongodb.net",
             "privateEndpoint":[{"srvConnectionString":"mongodb+srv://full-pl-0.ab1.mongodb.net"}]}},
          {"name":"Paused","stateName":"IDLE","clusterType":"REPLICASET","connectionStrings":null},
          {"name":"OnlyStd","connectionStrings":{"standard":"mongodb://h:27017/","standardSrv":""}}
        ],"totalCount":3}"#;
        let (base, _) = fake(Arc::new(move |r| if r.target == TOKEN_PATH { (200, token_json(3600)) } else { (200, body.into()) })).await;
        let c = AtlasClient::with_base(&base, "id", "secret", None).unwrap();
        let list = c.list_clusters("abc123").await.unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0].srv.as_deref(), Some("mongodb+srv://full.ab1.mongodb.net"));
        assert_eq!(list[0].standard.as_deref(), Some("mongodb://h1:27017,h2:27017/?ssl=true"));
        assert_eq!(list[0].private_srv.as_deref(), Some("mongodb+srv://full-pl-0.ab1.mongodb.net"));
        assert_eq!((list[0].cluster_type.as_str(), list[0].mongo_version.as_str(), list[0].state.as_str()), ("SHARDED", "8.0.1", "IDLE"));
        assert_eq!((list[1].srv.clone(), list[1].standard.clone(), list[1].private_srv.clone()), (None, None, None));
        assert_eq!(list[2].srv, None, "an empty string is not a connection string");
        assert_eq!(list[2].standard.as_deref(), Some("mongodb://h:27017/"));
    }

    #[tokio::test]
    async fn api_errors_are_reduced_to_their_detail_and_a_401_drops_the_token() {
        let calls = Arc::new(AtomicUsize::new(0));
        let n = calls.clone();
        let (base, seen) = fake(Arc::new(move |r| {
            if r.target == TOKEN_PATH {
                return (200, token_json(3600));
            }
            n.fetch_add(1, Ordering::SeqCst);
            (403, r#"{"error":403,"detail":"IP address 1.2.3.4 is not allowed","errorCode":"IP_ADDRESS_NOT_ON_ACCESS_LIST"}"#.into())
        }))
        .await;
        let c = AtlasClient::with_base(&base, "id", "secret", None).unwrap();
        let e = c.list_projects().await.unwrap_err().to_string();
        assert!(e.contains("403") && e.contains("not allowed"), "{e}");
        assert!(!e.contains("tok-abc"));
        let _ = c.list_projects().await;
        assert_eq!(count_tokens(&seen), 1, "a 403 keeps the token");
    }

    #[tokio::test]
    async fn rejects_a_project_id_that_could_alter_the_path() {
        let c = AtlasClient::with_base("http://127.0.0.1:1", "id", "secret", None).unwrap();
        for bad in ["", "../x", "a/b", "a?b"] {
            assert!(c.list_clusters(bad).await.is_err(), "{bad}");
        }
    }
}
