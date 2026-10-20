use crate::error::AppError;
use crate::query_library::{self, QueryNode};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn legacy_library_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("query_library.json"))
}

pub(crate) fn library_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("saved_queries"))
}

#[tauri::command]
pub fn load_query_library(app: AppHandle) -> Result<Vec<QueryNode>, AppError> {
    let dir = library_dir(&app)?;
    query_library::migrate_legacy(&legacy_library_path(&app)?, &dir)?;
    query_library::load(&dir)
}

/// The frontend always sends the full list; Rust splits it into `manifest.json` + one `<id>.json`
/// per query node (see query_library::save) instead of one big file overwritten wholesale.
#[tauri::command]
pub fn save_query_library(app: AppHandle, nodes: Vec<QueryNode>) -> Result<(), AppError> {
    query_library::save(&library_dir(&app)?, &nodes)
}
