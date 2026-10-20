use crate::audit::{AuditEntry, AuditError, AuditLog};
use crate::error::AppError;
use mongodb::bson::Document;
use crate::http_proxy_tunnel::HttpProxyTunnelHandle;
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
    /// The label the user sees for this connection; carried into audit records and the MCP list.
    pub label: String,
    /// "", "dev", "staging" or "prod" (see the frontend's `Environment`).
    pub environment: String,
    // Closes the SSH tunnel on drop; also asked whether it is down (see `AppState::tunnel_down`).
    pub tunnel: Option<SshTunnelHandle>,
    // Local HTTP CONNECT forwarder when the connection goes through an HTTP proxy; closes on drop.
    pub proxy_tunnel: Option<HttpProxyTunnelHandle>,
}

/// What the audit log and MCP need to know about a live session.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionMeta {
    pub label: String,
    pub environment: String,
    pub read_only: bool,
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
    /// Running change streams, keyed by (session, watch id); dropping the sender stops the stream.
    pub watches: Mutex<HashMap<(String, String), tokio::sync::oneshot::Sender<()>>>,
    /// Profiler levels the app raised, so they can be put back (see `commands::profiler`).
    pub profiler_holds: crate::commands::profiler::ProfilerHolds,
    /// Hash-chained log of write operations (see `crate::audit`).
    pub audit: AuditLog,
}

impl AppState {
    pub async fn insert_session(
        &self,
        session_id: String,
        client: Client,
        read_only: bool,
        label: String,
        environment: String,
        tunnel: Option<SshTunnelHandle>,
    ) {
        self.sessions.lock().await.insert(session_id, Session { client, read_only, label, environment, tunnel, proxy_tunnel: None });
    }

    /// Keeps an HTTP proxy forwarder alive for as long as the session lives.
    pub async fn set_proxy_tunnel(&self, session_id: &str, handle: HttpProxyTunnelHandle) {
        if let Some(s) = self.sessions.lock().await.get_mut(session_id) {
            s.proxy_tunnel = Some(handle);
        }
    }

    pub async fn meta(&self, session_id: &str) -> Result<SessionMeta, AppError> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|s| SessionMeta { label: s.label.clone(), environment: s.environment.clone(), read_only: s.read_only })
            .ok_or(AppError::NotConnected)
    }

    /// Relabels a live session (the user changed the connection's environment or name while it is open).
    pub async fn set_meta(&self, session_id: &str, label: String, environment: String) -> Result<(), AppError> {
        let mut g = self.sessions.lock().await;
        let s = g.get_mut(session_id).ok_or(AppError::NotConnected)?;
        s.label = label;
        s.environment = environment;
        Ok(())
    }

    /// `host:port` of the session's SSH server when its tunnel is currently down (never credentials).
    pub async fn tunnel_down(&self, session_id: &str) -> Option<String> {
        let g = self.sessions.lock().await;
        let t = g.get(session_id)?.tunnel.as_ref()?;
        t.is_down().then(|| t.endpoint())
    }

    pub async fn client(&self, session_id: &str) -> Result<Client, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.client.clone()).ok_or(AppError::NotConnected)
    }

    pub async fn read_only(&self, session_id: &str) -> Result<bool, AppError> {
        self.sessions.lock().await.get(session_id).map(|s| s.read_only).ok_or(AppError::NotConnected)
    }

    /// Runs a write and records it in the audit log (one line, success or failure) using the session's
    /// label and environment. `count` pulls the affected-document count out of a success value.
    /// A failure to write the audit line is logged, never allowed to fail the operation.
    pub async fn audited<T, E, Fut>(
        &self,
        session_id: &str,
        source: &str,
        op: &str,
        ns: &str,
        filter: Option<&Document>,
        count: impl FnOnce(&T) -> Option<u64>,
        fut: Fut,
    ) -> Result<T, E>
    where
        Fut: std::future::Future<Output = Result<T, E>>,
        E: AuditError,
    {
        let (label, environment) = match self.meta(session_id).await {
            Ok(m) => (m.label, m.environment),
            Err(_) => (String::new(), String::new()),
        };
        let res = fut.await;
        let entry = AuditEntry::new(source, op, ns).with_session(&label, &environment).with_filter(filter);
        let entry = match &res {
            Ok(v) => entry.with_count(count(v)),
            Err(e) => entry.with_error(&e.audit_summary()),
        };
        if let Err(e) = self.audit.record(entry) {
            tracing::error!("audit log write failed: {e}");
        }
        res
    }

    /// Drops the session (closing its SSH tunnel, if any) and its cancel flag together.
    pub async fn remove_session(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
        self.cancels.lock().await.retain(|(id, _), _| id != session_id);
        self.watches.lock().await.retain(|(id, _), _| id != session_id);
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
    async fn meta_returns_label_and_environment() {
        let state = AppState::default();
        state
            .insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), true, "Orders".into(), "prod".into(), None)
            .await;
        let m = state.meta("s1").await.unwrap();
        assert_eq!(m, SessionMeta { label: "Orders".into(), environment: "prod".into(), read_only: true });
        state.set_meta("s1", "Orders 2".into(), "staging".into()).await.unwrap();
        assert_eq!(state.meta("s1").await.unwrap().environment, "staging");
        assert!(matches!(state.meta("nope").await.unwrap_err(), AppError::NotConnected));
        assert!(matches!(state.set_meta("nope", "".into(), "".into()).await.unwrap_err(), AppError::NotConnected));
    }

    #[tokio::test]
    async fn audited_write_records_one_line_with_session_meta_and_failures() {
        let dir = std::env::temp_dir().join(format!("lumiong_state_audit_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        state
            .insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false, "Orders".into(), "prod".into(), None)
            .await;
        let filter = mongodb::bson::doc! { "email": "a@b.c" };
        let ok: Result<u64, AppError> = state.audited("s1", "ui", "update_many", "shop.orders", Some(&filter), |n| Some(*n), async { Ok(4) }).await;
        assert_eq!(ok.unwrap(), 4);
        let bad: Result<u64, AppError> =
            state.audited("s1", "ui", "delete_many", "shop.orders", None, |n| Some(*n), async { Err(AppError::Query("boom".into())) }).await;
        assert!(bad.is_err());
        let all = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!(all.len(), 2);
        let (fail, success) = (&all[0], &all[1]);
        assert!(success.ok && success.count == Some(4) && success.session_label == "Orders" && success.environment == "prod");
        assert_eq!(success.filter_redacted.as_ref().unwrap()["email"], "<str:5>");
        assert!(!fail.ok && fail.error.as_deref() == Some("Query"), "{:?}", fail.error);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn remove_session_clears_its_cancel_flag_too() {
        let state = AppState::default();
        state.insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false, "".into(), "".into(), None).await;
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
        state.insert_session("s1".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), true, "".into(), "".into(), None).await;
        assert!(state.ensure_writable("s1").await.is_err());
        state.insert_session("s2".into(), Client::with_uri_str("mongodb://localhost").await.unwrap(), false, "".into(), "".into(), None).await;
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
