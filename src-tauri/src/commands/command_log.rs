//! Optional on-disk command log: appends full command text to a daily file and reads one entry back.
use crate::command_log_file::{entry_block, file_name_for, files_to_prune, is_log_file_name};
use crate::error::AppError;
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const KEEP_DAYS: i64 = 7;
const MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

/// Serializes appends (so returned offsets are exact) and remembers the day last pruned.
#[derive(Default)]
pub struct CommandLogFile {
    pruned_for: Mutex<Option<String>>,
}

/// Where one command's full text lives on disk.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileRef {
    pub path: String,
    pub offset: u64,
    pub length: u64,
}

fn io(e: impl std::fmt::Display) -> AppError {
    AppError::Io(e.to_string())
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_log_dir().map_err(io)?.join("command-log"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn prune(dir: &Path, now: i64) -> Result<(), AppError> {
    let mut files = Vec::new();
    for e in std::fs::read_dir(dir).map_err(io)?.flatten() {
        if let (Ok(name), Ok(meta)) = (e.file_name().into_string(), e.metadata()) {
            files.push((name, meta.len()));
        }
    }
    for name in files_to_prune(&files, now, KEEP_DAYS, MAX_TOTAL_BYTES) {
        let _ = std::fs::remove_file(dir.join(name));
    }
    Ok(())
}

/// Appends one command (a header line, then its full text) to today's file.
#[tauri::command]
pub async fn command_log_append(
    app: AppHandle,
    header: String,
    text: String,
    state: State<'_, CommandLogFile>,
) -> Result<LogFileRef, AppError> {
    let dir = log_dir(&app)?;
    let pruned_for = &state.pruned_for;
    let mut last = pruned_for.lock().map_err(io)?;
    std::fs::create_dir_all(&dir).map_err(io)?;
    let now = now_ms();
    let name = file_name_for(now);
    if last.as_deref() != Some(name.as_str()) {
        prune(&dir, now)?;
        *last = Some(name.clone());
    }
    let path = dir.join(&name);
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(io)?;
    let start = file.metadata().map_err(io)?.len();
    let (block, text_offset) = entry_block(&header, &text);
    file.write_all(block.as_bytes()).map_err(io)?;
    Ok(LogFileRef { path: path.to_string_lossy().into_owned(), offset: start + text_offset, length: text.len() as u64 })
}

/// Reads one entry back. Only files this log wrote, inside its own folder, can be read.
#[tauri::command]
pub fn command_log_read(app: AppHandle, path: String, offset: u64, length: u64) -> Result<String, AppError> {
    let dir = log_dir(&app)?.canonicalize().map_err(io)?;
    let file_path = Path::new(&path).canonicalize().map_err(io)?;
    let name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if file_path.parent() != Some(dir.as_path()) || !is_log_file_name(name) {
        return Err(AppError::Io("not a command log file".into()));
    }
    let mut file = std::fs::File::open(&file_path).map_err(io)?;
    file.seek(SeekFrom::Start(offset)).map_err(io)?;
    let mut buf = Vec::new();
    file.take(length).read_to_end(&mut buf).map_err(io)?;
    if (buf.len() as u64) < length {
        return Err(AppError::Io("the command log file was cleared or rotated".into()));
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[tauri::command]
pub fn command_log_dir(app: AppHandle) -> Result<String, AppError> {
    Ok(log_dir(&app)?.to_string_lossy().into_owned())
}

/// Deletes every command log file; returns how many were removed.
#[tauri::command]
pub fn command_log_clear(app: AppHandle, state: State<'_, CommandLogFile>) -> Result<u32, AppError> {
    let _guard = state.pruned_for.lock().map_err(io)?;
    let dir = log_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(0) };
    let mut removed = 0;
    for e in entries.flatten() {
        if e.file_name().to_str().is_some_and(is_log_file_name) && std::fs::remove_file(e.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
