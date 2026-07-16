use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Document};
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

/// `local.startup_log` gets one entry per mongod restart — a history the serverStatus/hostInfo
/// snapshot can't show. `local` itself stays excluded from the namespace tree (SYSTEM_DBS).
#[tauri::command]
pub async fn startup_log(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let collection = client
        .database("local")
        .collection::<Document>("startup_log");
    let mut cursor = collection
        .find(doc! {})
        .sort(doc! { "startTime": -1 })
        .limit(20)
        .await?;
    let mut docs = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        docs.push(doc_to_canonical_string(d)?);
    }
    Ok(docs)
}

#[tauri::command]
pub async fn current_ops(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let resp = client
        .database("admin")
        .run_command(doc! { "currentOp": 1 })
        .await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn kill_op(
    session_id: String,
    opid: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.client(&session_id).await?;
    state.ensure_writable(&session_id).await?;
    client
        .database("admin")
        .run_command(doc! { "killOp": 1, "op": opid })
        .await?;
    Ok(())
}
