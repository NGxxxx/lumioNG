//! UI preferences stored as `prefs.json` in the app config dir (see `crate::prefs`).
use crate::error::AppError;
use crate::prefs::{self, Prefs};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn config_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_config_dir().map_err(|e| AppError::Io(e.to_string()))
}

/// Everything in `prefs.json` (empty when absent or corrupt).
#[tauri::command]
pub fn prefs_load(app: AppHandle) -> Result<Prefs, AppError> {
    Ok(prefs::load(&config_dir(&app)?))
}

/// Replaces `prefs.json` with `entries` (atomic).
#[tauri::command]
pub fn prefs_save(app: AppHandle, entries: Prefs) -> Result<(), AppError> {
    prefs::save(&config_dir(&app)?, &entries)
}

/// Writes the stored prefs (without secrets) to `path`.
#[tauri::command]
pub fn prefs_export(app: AppHandle, path: String) -> Result<(), AppError> {
    prefs::export(&config_dir(&app)?, Path::new(&path))
}

/// Reads a settings file: its allowed keys plus the current `mcp-*` values. The frontend adopts and saves the result.
#[tauri::command]
pub fn prefs_import(app: AppHandle, path: String) -> Result<Prefs, AppError> {
    prefs::import(&config_dir(&app)?, Path::new(&path))
}
