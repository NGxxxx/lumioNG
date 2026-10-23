//! Turns the built-in MCP server (see `crate::mcp`) on and off, and keeps its view of the open
//! connections in step with the frontend's session list.

use crate::error::AppError;
use crate::mcp::tools::ExposedSession;
use crate::mcp::{self, Activity, Backend, Shared};
use crate::state::AppState;
use serde::Serialize;
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::sync::{oneshot, Mutex, RwLock};

/// The bearer token must be long enough not to be guessable by another local process.
const MIN_TOKEN_LEN: usize = 16;

struct Running {
    port: u16,
    allow_writes: bool,
    // Held for its `Drop` side effect: dropping it stops the accept loop.
    #[allow(dead_code)]
    stop: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct McpServer {
    running: Mutex<Option<Running>>,
    /// Outlives restarts, so turning the server off and on keeps the connection list.
    sessions: Arc<RwLock<Vec<ExposedSession>>>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub allow_writes: bool,
}

struct TauriBackend {
    app: AppHandle,
    on_activity: Channel<Activity>,
}

impl Backend for TauriBackend {
    fn app_state(&self) -> &AppState {
        self.app.state::<AppState>().inner()
    }
    fn activity(&self, a: Activity) {
        let _ = self.on_activity.send(a);
    }
}

fn status_of(r: &Option<Running>) -> McpStatus {
    match r {
        Some(r) => McpStatus { running: true, port: Some(r.port), allow_writes: r.allow_writes },
        None => McpStatus { running: false, port: None, allow_writes: false },
    }
}

/// (Re)starts the server on 127.0.0.1:`port` with the given token; a running one is stopped first.
#[tauri::command]
pub async fn mcp_start(
    app: AppHandle,
    port: u16,
    token: String,
    allow_writes: bool,
    on_activity: Channel<Activity>,
    redact_fields: Option<Vec<String>>,
    audit_reads: Option<bool>,
    server: State<'_, McpServer>,
) -> Result<McpStatus, AppError> {
    if token.trim().len() < MIN_TOKEN_LEN {
        return Err(AppError::Parse(format!("MCP token must be at least {MIN_TOKEN_LEN} characters")));
    }
    if port == 0 {
        return Err(AppError::Parse("MCP port must be between 1 and 65535".into()));
    }
    let mut running = server.running.lock().await;
    *running = None; // stop the old listener before binding (the port may be the same)
    let shared = Arc::new(Shared {
        token: token.trim().to_string(),
        allow_writes,
        sessions: server.sessions.clone(),
        redact_fields: redact_fields.unwrap_or_else(crate::mcp::redact::default_patterns),
        audit_reads: audit_reads.unwrap_or(false),
    });
    let backend = Arc::new(TauriBackend { app, on_activity });
    let (bound, stop) = mcp::start(backend, shared, port)
        .await
        .map_err(|e| AppError::Io(format!("cannot listen on 127.0.0.1:{port}: {e}")))?;
    *running = Some(Running { port: bound, allow_writes, stop });
    Ok(status_of(&running))
}

#[tauri::command]
pub async fn mcp_stop(server: State<'_, McpServer>) -> Result<(), AppError> {
    *server.running.lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn mcp_status(server: State<'_, McpServer>) -> Result<McpStatus, AppError> {
    Ok(status_of(&*server.running.lock().await))
}

/// Replaces the list of connections MCP clients can see (the frontend calls it whenever sessions
/// open, close or get relabelled).
#[tauri::command]
pub async fn mcp_set_sessions(sessions: Vec<ExposedSession>, server: State<'_, McpServer>) -> Result<(), AppError> {
    *server.sessions.write().await = normalize_sessions(sessions);
    Ok(())
}

/// Drops connections the user did not share (`access: "off"`) and clamps the rest to a valid level
/// (a PROD connection is never `write`, whatever the frontend sent).
fn normalize_sessions(sessions: Vec<ExposedSession>) -> Vec<ExposedSession> {
    sessions
        .into_iter()
        .filter(|s| s.access != crate::registry::MCP_ACCESS_OFF)
        .map(|mut s| {
            s.access = crate::registry::clamp_mcp_access(&s.environment, &s.access);
            s
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exposed(id: &str, environment: &str, access: &str) -> ExposedSession {
        ExposedSession { id: id.into(), label: id.into(), environment: environment.into(), read_only: false, access: access.into() }
    }

    #[test]
    fn off_connections_are_not_listed() {
        let out = normalize_sessions(vec![exposed("a", "dev", "off"), exposed("b", "dev", "read"), exposed("c", "dev", "write")]);
        assert_eq!(out.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b", "c"]);
    }

    #[test]
    fn prod_is_clamped_to_read_and_junk_access_to_read() {
        let out = normalize_sessions(vec![exposed("p", "prod", "write"), exposed("j", "dev", "root")]);
        assert_eq!(out[0].access, "read");
        assert_eq!(out[1].access, "read");
    }

    #[test]
    fn status_reflects_running_state() {
        assert_eq!(status_of(&None), McpStatus { running: false, port: None, allow_writes: false });
        let (tx, _rx) = oneshot::channel();
        let r = Some(Running { port: 7811, allow_writes: true, stop: tx });
        assert_eq!(status_of(&r), McpStatus { running: true, port: Some(7811), allow_writes: true });
    }
}
