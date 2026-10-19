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
    let shared = Arc::new(Shared { token: token.trim().to_string(), allow_writes, sessions: server.sessions.clone() });
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
    *server.sessions.write().await = sessions;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reflects_running_state() {
        assert_eq!(status_of(&None), McpStatus { running: false, port: None, allow_writes: false });
        let (tx, _rx) = oneshot::channel();
        let r = Some(Running { port: 7811, allow_writes: true, stop: tx });
        assert_eq!(status_of(&r), McpStatus { running: true, port: Some(7811), allow_writes: true });
    }
}
