use crate::error::AppError;
use crate::script::engine;
use crate::script::outcome::ScriptOutcome;
use crate::state::{AppState, CancelScope};
use tauri::State;

#[tauri::command]
pub async fn run_script(
    session_id: String,
    db: String,
    script: String,
    timeout_ms: Option<u64>,
    cap: Option<u64>,
    state: State<'_, AppState>,
) -> Result<ScriptOutcome, AppError> {
    let client = state.client(&session_id).await?;
    let cancel = state.begin_cancel(&session_id, CancelScope::Interactive).await;
    let meta = state.meta(&session_id).await?;
    let read_only = meta.read_only;
    let audit = crate::script::host::ScriptAudit { log: state.audit.clone(), label: meta.label, environment: meta.environment };
    let handle = tokio::runtime::Handle::current();
    let timeout = timeout_ms.unwrap_or(30_000);
    let cap = cap.unwrap_or(1000) as usize;
    // engine::run drives QuickJS synchronously and calls Handle::block_on for DB work,
    // so it must own a blocking thread.
    let outcome = tokio::task::spawn_blocking(move || {
        engine::run(client, handle, db, script, timeout, cap, read_only, cancel, Some(audit))
    })
    .await
    .map_err(|e| AppError::Query(e.to_string()))?;
    Ok(outcome)
}

#[tauri::command]
pub async fn cancel_script(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.request_cancel(&session_id, CancelScope::Interactive).await;
    Ok(())
}
