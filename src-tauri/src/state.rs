use mongodb::Client;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub client: Mutex<Option<Client>>,
}
