use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use mongodb::bson::doc;
use mongodb::Client;
use tauri::State;

/// Runs a single-field `{ <cmd_name>: 1 }` admin command and serializes the reply.
async fn run_admin_command(client: &Client, cmd_name: &str) -> Result<String, AppError> {
    let resp = client.database("admin").run_command(doc! { cmd_name: 1 }).await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn server_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "serverStatus").await
}

#[tauri::command]
pub async fn build_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "buildInfo").await
}

#[tauri::command]
pub async fn host_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "hostInfo").await
}

#[tauri::command]
pub async fn current_ops(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "currentOp").await
}

#[tauri::command]
pub async fn kill_op(
    session_id: String,
    opid: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    client
        .database("admin")
        .run_command(doc! { "killOp": 1, "op": opid })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn is_master(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "isMaster").await
}

#[tauri::command]
pub async fn repl_set_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "replSetGetStatus").await
}

#[tauri::command]
pub async fn list_shards(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "listShards").await
}

#[tauri::command]
pub async fn balancer_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "balancerStatus").await
}
