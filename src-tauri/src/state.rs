use crate::error::AppError;
use crate::ssh_tunnel::SshTunnelHandle;
use mongodb::Client;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;

/// A live connection plus the read-only flag; `tunnel` is `Some` when SSH-tunneled — dropping it closes the tunnel.
pub struct Session {
    pub client: Client,
    pub read_only: bool,
    // Held only for its `Drop` side effect (closes the SSH tunnel) — never read directly.
    #[allow(dead_code)]
    pub tunnel: Option<SshTunnelHandle>,
}

/// The family of operations a cancel flag covers. Kept apart so Stop in a query tab never aborts a
/// background export, and starting a grid query never resets an export's pending cancel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CancelScope {
    /// Grid/query commands and scripts — cancelled by the query tab's Stop.
    Interactive,
    /// Exports, imports and GridFS downloads — cancelled from the job's own Cancel.
    Job,
}

#[derive(Default)]
pub struct AppState {
    pub sessions: Mutex<HashMap<String, Session>>,
    /// Cooperative cancel flags, one per session and scope.
    pub cancels: Mutex<HashMap<(String, CancelScope), Arc<AtomicBool>>>,
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
        self.cancels.lock().await.retain(|(id, _), _| id != session_id);
    }

    /// Reject a write command when the session's connection is read-only.
    pub async fn ensure_writable(&self, session_id: &str) -> Result<(), AppError> {
        crate::error::ensure_writable(self.read_only(session_id).await?)
    }

    /// Client fetch + write guard, combined.
    pub async fn writable_client(&self, session_id: &str) -> Result<Client, AppError> {
        let client = self.client(session_id).await?;
        self.ensure_writable(session_id).await?;
        Ok(client)
    }

    /// Returns the session's cancel flag, creating a fresh (false) one on first access.
    pub async fn cancel_flag(&self, session_id: &str, scope: CancelScope) -> Arc<AtomicBool> {
        let mut g = self.cancels.lock().await;
        g.entry((session_id.to_string(), scope)).or_default().clone()
    }

    pub async fn request_cancel(&self, session_id: &str, scope: CancelScope) {
        self.cancel_flag(session_id, scope).await.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    /// Fetches the session's cancel flag and resets it to `false`, ready for a new cancellable op.
    pub async fn begin_cancel(&self, session_id: &str, scope: CancelScope) -> Arc<AtomicBool> {
        let flag = self.cancel_flag(session_id, scope).await;
        flag.store(false, std::sync::atomic::Ordering::Relaxed);
        flag
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
        state.cancel_flag("s1", CancelScope::Job).await;
        state.cancel_flag("s2", CancelScope::Job).await;
        state.remove_session("s1").await;
        assert!(state.sessions.lock().await.get("s1").is_none());
        assert!(state.cancels.lock().await.keys().all(|(id, _)| id != "s1"));
        assert_eq!(state.cancels.lock().await.len(), 1);
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
        let f = state.cancel_flag("s1", CancelScope::Interactive).await;
        assert!(!f.load(std::sync::atomic::Ordering::Relaxed));
        state.request_cancel("s1", CancelScope::Interactive).await;
        assert!(state.cancel_flag("s1", CancelScope::Interactive).await.load(std::sync::atomic::Ordering::Relaxed));
        state.begin_cancel("s1", CancelScope::Interactive).await;
        assert!(!state.cancel_flag("s1", CancelScope::Interactive).await.load(std::sync::atomic::Ordering::Relaxed));
    }

    #[tokio::test]
    async fn begin_cancel_resets_a_previously_set_flag() {
        let state = AppState::default();
        state.request_cancel("s1", CancelScope::Interactive).await;
        let flag = state.begin_cancel("s1", CancelScope::Interactive).await;
        assert!(!flag.load(std::sync::atomic::Ordering::Relaxed));
    }

    #[tokio::test]
    async fn scopes_are_independent() {
        let state = AppState::default();
        let job = state.begin_cancel("s1", CancelScope::Job).await;
        // Stop in a query tab must not abort the export…
        state.request_cancel("s1", CancelScope::Interactive).await;
        assert!(!job.load(std::sync::atomic::Ordering::Relaxed));
        // …and a new grid query must not swallow the export's pending cancel.
        state.request_cancel("s1", CancelScope::Job).await;
        state.begin_cancel("s1", CancelScope::Interactive).await;
        assert!(job.load(std::sync::atomic::Ordering::Relaxed));
    }
}
