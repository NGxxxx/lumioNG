use crate::error::AppError;
use mongodb::Client;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A live connection plus the read-only flag from its saved connection profile.
pub struct Session {
    pub client: Client,
    pub read_only: bool,
}

#[derive(Default)]
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    /// Per-session cooperative cancel flag, shared by every cancellable operation on that
    /// session (script runs, and every `commands/query.rs` command). Every one of those callers
    /// clears the flag before starting its own work (see `clear_cancel`), matching the existing
    /// `run_script` pattern — but this means the flag is NOT per-operation: if op A is cancelled
    /// (flag set true) and op B starts on the same session before A's poll loop observes it, B's
    /// startup `clear_cancel` silently resets the flag and A's cancellation is lost. This is a
    /// known, accepted trade-off of the single-flag design (reusing per-request cancel tokens
    /// would need `Vec<Arc<AtomicBool>>` per session, registered/unregistered per op) rather than
    /// a bug to fix opportunistically — flagged here so it isn't rediscovered as a surprise.
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub async fn insert_session(&self, session_id: String, client: Client, read_only: bool) {
        self.sessions.lock().await.insert(session_id, Session { client, read_only });
    }

    pub async fn client(&self, session_id: &str) -> Result<Client, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.client.clone()).ok_or(AppError::NotConnected)
    }

    pub async fn read_only(&self, session_id: &str) -> Result<bool, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.read_only).ok_or(AppError::NotConnected)
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
    async fn ensure_writable_blocks_read_only_session() {
        let state = AppState::default();
        state.insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), true).await;
        assert!(state.ensure_writable("s1").await.is_err());
        state.insert_session("s2".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false).await;
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
