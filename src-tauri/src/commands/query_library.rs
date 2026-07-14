use crate::error::AppError;
use crate::query_library::{self, QueryNode};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn library_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.join("query_library.json"))
}

#[tauri::command]
pub fn load_query_library(app: AppHandle) -> Result<Vec<QueryNode>, AppError> {
    query_library::load(&library_path(&app)?)
}

/// The frontend always sends the full list; the file is overwritten wholesale (no tree logic in Rust).
#[tauri::command]
pub fn save_query_library(app: AppHandle, nodes: Vec<QueryNode>) -> Result<(), AppError> {
    query_library::save(&library_path(&app)?, &nodes)
}
