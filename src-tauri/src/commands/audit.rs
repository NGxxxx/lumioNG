//! Audit log controls and reader (see `crate::audit`). Writing happens at the write points, not here.
use crate::audit::{AuditEntry, AuditScope, VerifyReport};
use crate::error::AppError;
use crate::state::AppState;
// Reading a large log is file I/O and hashing: keep it off the async runtime.
use crate::util::blocking;
use std::path::Path;
use tauri::State;

/// Which environments are audited. The frontend keeps the choice in prefs and pushes it at startup
/// and whenever it changes; until then Rust audits PROD only.
#[tauri::command]
pub fn audit_set_scope(scope: AuditScope, state: State<'_, AppState>) -> Result<(), AppError> {
    state.audit.set_scope(scope);
    Ok(())
}

/// Entries with `from_ms <= ts <= to_ms` (epoch millis), newest first, optionally one environment.
#[tauri::command]
pub async fn audit_query(from_ms: i64, to_ms: i64, environment: Option<String>, state: State<'_, AppState>) -> Result<Vec<AuditEntry>, AppError> {
    let log = state.audit.clone();
    blocking(move || log.query(from_ms, to_ms, environment.as_deref())).await
}

/// Re-computes the hash chain of every audit file.
#[tauri::command]
pub async fn audit_verify(state: State<'_, AppState>) -> Result<VerifyReport, AppError> {
    let log = state.audit.clone();
    blocking(move || log.verify()).await
}

/// Copies the whole log (JSONL, chain intact) to `path`; returns the number of lines.
#[tauri::command]
pub async fn audit_export(path: String, state: State<'_, AppState>) -> Result<u64, AppError> {
    let log = state.audit.clone();
    blocking(move || log.export(Path::new(&path))).await
}
