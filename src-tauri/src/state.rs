use crate::error::AppError;
use mongodb::Client;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub client: Mutex<Option<Client>>,
}

impl AppState {
    /// Clone the active client, or `NotConnected` if none.
    pub async fn client(&self) -> Result<Client, AppError> {
        self.client
            .lock()
            .await
            .as_ref()
            .ok_or(AppError::NotConnected)
            .cloned()
    }
}
