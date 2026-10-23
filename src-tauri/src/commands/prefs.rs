//! UI preferences stored as `prefs.json` in the app config dir (see `crate::prefs`).
use crate::error::AppError;
use crate::prefs::{self, Prefs};
use std::path::Path;
use crate::util::{blocking, config_dir, lock_recover};
use std::sync::Mutex;
use tauri::AppHandle;

/// Serializes the file work below: the commands run on the blocking pool, and two overlapping saves
/// must not interleave on `prefs.json.tmp`.
static PREFS_IO: Mutex<()> = Mutex::new(());

/// Runs `f` with the config dir, off the main thread and one at a time.
async fn with_dir<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&Path) -> Result<T, AppError> + Send + 'static) -> Result<T, AppError> {
    let dir = config_dir(&app)?;
    blocking(move || {
        let _io = lock_recover(&PREFS_IO);
        f(&dir)
    })
    .await
}

/// Everything in `prefs.json` (empty when absent or corrupt).
#[tauri::command]
pub async fn prefs_load(app: AppHandle) -> Result<Prefs, AppError> {
    with_dir(app, |dir| Ok(prefs::load(dir))).await
}

/// Replaces `prefs.json` with `entries` (atomic).
#[tauri::command]
pub async fn prefs_save(app: AppHandle, entries: Prefs) -> Result<(), AppError> {
    with_dir(app, move |dir| prefs::save(dir, &entries)).await
}

/// Writes the stored prefs (without secrets) to `path`.
#[tauri::command]
pub async fn prefs_export(app: AppHandle, path: String) -> Result<(), AppError> {
    with_dir(app, move |dir| prefs::export(dir, Path::new(&path))).await
}

/// Reads a settings file: its allowed keys plus the current `mcp-*` values. The frontend adopts and saves the result.
#[tauri::command]
pub fn prefs_import(app: AppHandle, path: String) -> Result<Prefs, AppError> {
    prefs::import(&config_dir(&app)?, Path::new(&path))
}
