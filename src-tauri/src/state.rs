use crate::error::AppError;
use crate::ssh_tunnel::SshTunnelHandle;
use mongodb::Client;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A live connection plus the read-only flag from its saved connection profile. `tunnel` is
/// `Some` when the session connected through an SSH tunnel; dropping it (when the `Session` is
/// removed on disconnect) aborts the forwarding task and closes the tunnel.
pub struct Session {
    pub client: Client,
    pub read_only: bool,
    // Held only for its `Drop` side effect (closes the SSH tunnel) — never read directly.
    #[allow(dead_code)]
    pub tunnel: Option<SshTunnelHandle>,
}

#[derive(Default)]
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    /// Per-session cooperative cancel flag, shared by every cancellable op on that session — see git history for the single-flag tradeoff rationale if this surprises you.
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub async fn insert_session(
        &self,
        session_id: String,
        client: Client,
        read_only: bool,
        tunnel: Option<SshTunnelHandle>,
    ) {
        self.sessions.lock().await.insert(session_id, Session { client, read_only, tunnel });
    }

    pub async fn client(&self, session_id: &str) -> Result<Client, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.client.clone()).ok_or(AppError::NotConnected)
    }

    pub async fn read_only(&self, session_id: &str) -> Result<bool, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.read_only).ok_or(AppError::NotConnected)
    }

    /// Drops the session (closing its SSH tunnel, if any) and its cancel flag together.
    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
        self.cancels.lock().await.remove(session_id);
    }

    /// Reject a write command when the session's connection is read-only.
    pub async fn ensure_writable(&self, session_id: &str) -> Result<(), AppError> {
        crate::error::ensure_writable(self.read_only(session_id).await?)
    }

    /// Returns the session's cancel flag, creating a fresh (false) one on first access.
    pub async fn cancel_flag(&self, session_id: &str) -> Arc<AtomicBool> {
        let mut g = self.cancels.lock().await;
        g.entry(session_id.to_string()).or_insert_with(|| Arc::new(AtomicBool::new(false))).clone()
    }

    pub async fn request_cancel(&self, session_id: &str) {
        self.cancel_flag(session_id).await.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub async fn clear_cancel(&self, session_id: &str) {
        self.cancel_flag(session_id).await.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_session_is_not_connected() {
        let state = AppState::default();
        assert!(matches!(state.client("missing").await.unwrap_err(), AppError::NotConnected));
        assert!(matches!(state.read_only("missing").await.unwrap_err(), AppError::NotConnected));
    }

    #[tokio::test]
    async fn remove_session_clears_its_cancel_flag_too() {
        let state = AppState::default();
        state.insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false, None).await;
        state.cancel_flag("s1").await;
        state.remove_session("s1").await;
        assert!(state.sessions.lock().await.get("s1").is_none());
        assert!(state.cancels.lock().await.get("s1").is_none());
    }

    #[tokio::test]
    async fn ensure_writable_blocks_read_only_session() {
        let state = AppState::default();
        state.insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), true, None).await;
        assert!(state.ensure_writable("s1").await.is_err());
        state.insert_session("s2".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false, None).await;
        assert!(state.ensure_writable("s2").await.is_ok());
    }

    #[tokio::test]
    async fn cancel_flag_is_stable_and_settable() {
        let state = AppState::default();
        let f = state.cancel_flag("s1").await;
        assert!(!f.load(std::sync::atomic::Ordering::Relaxed));
        state.request_cancel("s1").await;
        assert!(state.cancel_flag("s1").await.load(std::sync::atomic::Ordering::Relaxed));
        state.clear_cancel("s1").await;
        assert!(!state.cancel_flag("s1").await.load(std::sync::atomic::Ordering::Relaxed));
    }
}
