//! Built-in MCP (Model Context Protocol) server: lets an AI client (Claude Code, Claude Desktop,
//! Cursor, VS Code…) browse and query the connections open in LumioNG.
//!
//! Transport is MCP "Streamable HTTP" reduced to its JSON-response form: `POST /mcp` carries one
//! JSON-RPC message (or a batch) and gets a JSON reply; notifications get `202`. It listens on
//! 127.0.0.1 only, every request needs the bearer token, and a browser `Origin` that isn't local is
//! refused (DNS-rebinding guard). The server is off until the user turns it on.

pub mod http;
pub mod redact;
pub mod tools;

use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::{oneshot, RwLock};
use tools::{ExposedSession, ToolCtx};

/// Newest first; an unknown requested version is answered with the newest.
pub const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
pub const ENDPOINT: &str = "/mcp";
const READ_TIMEOUT: Duration = Duration::from_secs(30);

const INSTRUCTIONS: &str = "LumioNG exposes the MongoDB connections the user has open in the app. \
Start with list_connections, then list_databases / list_collections, and collection_schema before \
writing queries, and explain to check that a query uses an index. Results are capped (100 documents); prefer filters, projections and $limit. Some fields are redacted and cannot be filtered on.";

/// One tool call, reported to the app's UI (MCP settings → recent activity).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub tool: String,
    pub connection: Option<String>,
    pub ok: bool,
    pub ms: u64,
    pub error: Option<String>,
}

/// What the server needs from the app: the live sessions and somewhere to report activity.
pub trait Backend: Send + Sync + 'static {
    fn app_state(&self) -> &AppState;
    fn activity(&self, a: Activity);
}

pub struct Shared {
    pub token: String,
    pub allow_writes: bool,
    pub sessions: Arc<RwLock<Vec<ExposedSession>>>,
    /// Field-name patterns redacted from results.
    pub redact_fields: Vec<String>,
    /// Also audit read tool calls.
    pub audit_reads: bool,
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// Handles one JSON-RPC message; `None` for notifications (and responses), which get no reply.
pub async fn handle_rpc<B: Backend>(b: &B, shared: &Shared, msg: Value) -> Option<Value> {
    let Some(obj) = msg.as_object() else { return Some(rpc_error(Value::Null, -32600, "invalid request")) };
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(rpc_error(obj.get("id").cloned().unwrap_or(Value::Null), -32600, "jsonrpc must be \"2.0\""));
    }
    let id = obj.get("id").cloned()?; // no id: a notification (or a client response) — nothing to answer
    let Some(method) = obj.get("method").and_then(Value::as_str) else {
        // A response to a server request (we never send any) needs no answer; anything else is malformed.
        let is_response = obj.contains_key("result") || obj.contains_key("error");
        return (!is_response).then(|| rpc_error(id, -32600, "method is required"));
    };
    let params = obj.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOL_VERSIONS[0]);
            rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "lumiong", "title": "LumioNG", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({ "tools": tools::tool_list(shared.allow_writes) })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(rpc_error(id, -32602, "params.name is required"));
            };
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let sessions = shared.sessions.read().await.clone();
            let ctx = ToolCtx {
                state: b.app_state(),
                sessions: &sessions,
                allow_writes: shared.allow_writes,
                redact: &shared.redact_fields,
                audit_reads: shared.audit_reads,
            };
            let started = Instant::now();
            let outcome = tools::call_tool(&ctx, name, &args).await;
            let connection = tools::resolve_session(&sessions, &args).ok().map(|s| s.label.clone());
            b.activity(Activity {
                tool: name.to_string(),
                connection: if name == "list_connections" { None } else { connection },
                ok: outcome.is_ok(),
                ms: started.elapsed().as_millis() as u64,
                error: outcome.as_ref().err().cloned(),
            });
            let (text, is_error) = match outcome {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            rpc_result(id, json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        _ => rpc_error(id, -32601, &format!("method not found: {method}")),
    })
}

/// Byte-wise comparison whose time doesn't depend on where the first difference is.
fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A browser page may only reach us from a local origin; non-browser clients send no Origin.
fn origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(o) => {
            let host = o.split("://").nth(1).unwrap_or("");
            let host = host.split(['/', ':']).next().unwrap_or("");
            matches!(host, "127.0.0.1" | "localhost" | "[::1]")
        }
    }
}

const JSON: &str = "application/json";

/// Maps one HTTP request to its response bytes.
pub async fn handle_http<B: Backend>(b: &B, shared: &Shared, req: http::Request) -> Vec<u8> {
    let path = req.path.split('?').next().unwrap_or("");
    if path != ENDPOINT {
        return http::response(404, None, b"", &[]);
    }
    if !origin_allowed(req.header("origin")) {
        return http::response(403, None, b"", &[]);
    }
    let authorized = req
        .header("authorization")
        .and_then(|h| h.strip_prefix("Bearer "))
        .is_some_and(|t| same_secret(t.trim(), &shared.token));
    if !authorized {
        return http::response(401, Some(JSON), br#"{"error":"missing or wrong bearer token"}"#, &[("WWW-Authenticate", "Bearer")]);
    }
    if req.method != "POST" {
        // No server-initiated stream (GET) and no stateful sessions (DELETE).
        return http::response(405, None, b"", &[("Allow", "POST")]);
    }
    let msg: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(_) => {
            let body = rpc_error(Value::Null, -32700, "parse error").to_string();
            return http::response(400, Some(JSON), body.as_bytes(), &[]);
        }
    };
    let reply = match msg {
        Value::Array(batch) => {
            let mut out = Vec::new();
            for m in batch {
                if let Some(r) = handle_rpc(b, shared, m).await {
                    out.push(r);
                }
            }
            if out.is_empty() { None } else { Some(Value::Array(out)) }
        }
        single => handle_rpc(b, shared, single).await,
    };
    match reply {
        Some(v) => http::response(200, Some(JSON), v.to_string().as_bytes(), &[]),
        None => http::response(202, None, b"", &[]),
    }
}

/// Binds 127.0.0.1:`port` (0 = any free port) and serves until the returned sender is dropped or
/// fired. Returns the bound port.
pub async fn start<B: Backend>(backend: Arc<B>, shared: Arc<Shared>, port: u16) -> std::io::Result<(u16, oneshot::Sender<()>)> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let bound = listener.local_addr()?.port();
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut stop_rx => break,
                accepted = listener.accept() => {
                    let Ok((mut stream, _)) = accepted else { continue };
                    let backend = backend.clone();
                    let shared = shared.clone();
                    tokio::spawn(async move {
                        let bytes = match tokio::time::timeout(READ_TIMEOUT, http::read_request(&mut stream)).await {
                            Ok(Ok(req)) => handle_http(backend.as_ref(), &shared, req).await,
                            Ok(Err(http::ReadError::Bad(code, why))) => http::response(code, Some("text/plain"), why.as_bytes(), &[]),
                            Ok(Err(http::ReadError::Closed)) | Err(_) => return,
                        };
                        let _ = stream.write_all(&bytes).await;
                        let _ = stream.shutdown().await;
                    });
                }
            }
        }
    });
    Ok((bound, stop_tx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpStream;

    #[derive(Default)]
    struct TestBackend {
        state: AppState,
        seen: Mutex<Vec<Activity>>,
    }
    impl Backend for TestBackend {
        fn app_state(&self) -> &AppState {
            &self.state
        }
        fn activity(&self, a: Activity) {
            self.seen.lock().unwrap().push(a);
        }
    }

    fn shared(allow_writes: bool) -> Shared {
        let sessions = vec![ExposedSession { id: "s1".into(), label: "Local".into(), environment: String::new(), read_only: false, access: "write".into() }];
        Shared { token: "secret-token-123456".into(), allow_writes, sessions: Arc::new(RwLock::new(sessions)), redact_fields: Vec::new(), audit_reads: false }
    }

    async fn rpc(b: &TestBackend, s: &Shared, msg: Value) -> Option<Value> {
        handle_rpc(b, s, msg).await
    }

    #[tokio::test]
    async fn initialize_negotiates_version() {
        let (b, s) = (TestBackend::default(), shared(false));
        let r = rpc(&b, &s, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).await.unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "lumiong");
        let r = rpc(&b, &s, json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": { "protocolVersion": "1999-01-01" } })).await.unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
    }

    #[tokio::test]
    async fn notifications_get_no_reply_and_unknown_methods_error() {
        let (b, s) = (TestBackend::default(), shared(false));
        assert!(rpc(&b, &s, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await.is_none());
        let r = rpc(&b, &s, json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).await.unwrap();
        assert_eq!(r["error"]["code"], -32601);
        let r = rpc(&b, &s, json!({ "id": 3, "method": "ping" })).await.unwrap();
        assert_eq!(r["error"]["code"], -32600);
    }

    #[tokio::test]
    async fn tools_call_reports_activity_and_errors_as_results() {
        let (b, s) = (TestBackend::default(), shared(false));
        let r = rpc(&b, &s, json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "list_connections" } })).await.unwrap();
        assert_eq!(r["result"]["isError"], false);
        assert!(r["result"]["content"][0]["text"].as_str().unwrap().contains("Local"));
        let r = rpc(&b, &s, json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "list_databases", "arguments": {} } })).await.unwrap();
        assert_eq!(r["result"]["isError"], true); // s1 has no live client in this test
        let seen = b.seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(seen[0].ok && !seen[1].ok);
        assert_eq!(seen[1].connection.as_deref(), Some("Local"));
    }

    #[test]
    fn origin_guard() {
        assert!(origin_allowed(None));
        assert!(origin_allowed(Some("http://localhost:5173")));
        assert!(origin_allowed(Some("http://127.0.0.1")));
        assert!(!origin_allowed(Some("https://evil.example")));
        assert!(!origin_allowed(Some("http://localhost.evil.example")));
    }

    #[test]
    fn secret_comparison() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }

    async fn send(port: u16, raw: String) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(raw.as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    fn post(token: Option<&str>, body: &str, origin: Option<&str>) -> String {
        let mut h = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", body.len());
        if let Some(t) = token {
            h.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
        if let Some(o) = origin {
            h.push_str(&format!("Origin: {o}\r\n"));
        }
        format!("{h}\r\n{body}")
    }

    #[tokio::test]
    async fn serves_over_tcp_with_auth_and_stops() {
        let backend = Arc::new(TestBackend::default());
        let (port, stop) = start(backend, Arc::new(shared(false)), 0).await.unwrap();
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;

        assert!(send(port, post(None, init, None)).await.starts_with("HTTP/1.1 401"));
        assert!(send(port, post(Some("wrong-token"), init, None)).await.starts_with("HTTP/1.1 401"));
        assert!(send(port, post(Some("secret-token-123456"), init, Some("https://evil.example"))).await.starts_with("HTTP/1.1 403"));

        let ok = send(port, post(Some("secret-token-123456"), init, None)).await;
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains("\"protocolVersion\":\"2025-06-18\""));

        let note = send(port, post(Some("secret-token-123456"), r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, None)).await;
        assert!(note.starts_with("HTTP/1.1 202"));

        let bad = send(port, post(Some("secret-token-123456"), "{not json", None)).await;
        assert!(bad.starts_with("HTTP/1.1 400") && bad.contains("-32700"));

        let get = send(port, "GET /mcp HTTP/1.1\r\nAuthorization: Bearer secret-token-123456\r\n\r\n".into()).await;
        assert!(get.starts_with("HTTP/1.1 405"));
        assert!(send(port, "GET /other HTTP/1.1\r\n\r\n".into()).await.starts_with("HTTP/1.1 404"));

        let batch = send(port, post(Some("secret-token-123456"), r#"[{"jsonrpc":"2.0","id":7,"method":"ping"},{"jsonrpc":"2.0","method":"x"}]"#, None)).await;
        assert!(batch.contains(r#"[{"id":7,"jsonrpc":"2.0","result":{}}]"#) || batch.contains("\"id\":7"));

        drop(stop);
        tokio::time::sleep(Duration::from_millis(50)).await;
        // Once stopped, the port no longer accepts connections.
        assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err());
    }
}
