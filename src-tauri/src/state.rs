use crate::error::AppError;
use mongodb::Client;
use std::collections::HashMap;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    /// One live client per open session, keyed by frontend-assigned session id.
    pub sessions: Mutex<HashMap<String, Client>>,
}

impl AppState {
    /// Clone the client for `session_id`, or `NotConnected` if none is open.
    pub async fn client(&self, session_id: &str) -> Result<Client, AppError> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or(AppError::NotConnected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_session_is_not_connected() {
        let state = AppState::default();
        let err = state.client("missing").await.unwrap_err();
        assert!(matches!(err, AppError::NotConnected));
    }
}
