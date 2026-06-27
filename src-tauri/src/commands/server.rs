use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use mongodb::bson::doc;
use tauri::State;

#[tauri::command]
pub async fn server_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let resp = client
        .database("admin")
        .run_command(doc! { "serverStatus": 1 })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn build_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let resp = client
        .database("admin")
        .run_command(doc! { "buildInfo": 1 })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn host_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let resp = client
        .database("admin")
        .run_command(doc! { "hostInfo": 1 })
        .await?;
    doc_to_canonical_string(resp)
}
