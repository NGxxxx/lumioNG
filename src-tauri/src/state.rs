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
    /// Per-session cooperative cancel flags for running scripts.
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
