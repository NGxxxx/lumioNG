//! Frontend log bridge, the diagnostics bundle (.zip) and local crash reports.
//! Everything written here goes through `redact` — no password, token or unmasked URI leaves the app.
use crate::commands::app::{build_info, AppInfo};
use crate::error::AppError;
use crate::logging::{self, CrashReport};
use crate::redact::redact_text;
use crate::registry::{self, SavedConnection};
use serde_json::{json, Value};
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Newest log files included in a bundle.
const BUNDLE_LOG_FILES: usize = 3;
/// A runaway frontend message must not flood the log file.
const MAX_FRONTEND_TEXT: usize = 4000;

fn io(e: impl std::fmt::Display) -> AppError {
    AppError::Io(e.to_string())
}

fn clip(s: &str) -> String {
    redact_text(&s.chars().take(MAX_FRONTEND_TEXT).collect::<String>())
}

/// Records a frontend error/warning/info line in the app log. Unknown levels are logged as info.
#[tauri::command]
pub fn log_frontend(level: String, message: String, context: Option<String>) {
    let message = clip(&message);
    let context = context.as_deref().map(clip).unwrap_or_default();
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", %context, "{message}"),
        "warn" => tracing::warn!(target: "frontend", %context, "{message}"),
        _ => tracing::info!(target: "frontend", %context, "{message}"),
    }
}

/// A connection profile reduced to non-secret, non-personal fields (no `*Enc` secrets, user, key paths, legacy `uri`).
fn redacted_connection(c: &SavedConnection) -> Value {
    json!({
        "id": c.id,
        "scheme": c.scheme,
        "host": c.host,
        "port": c.port,
        "authMethod": c.auth_method,
        "authSource": c.auth_source,
        "replicaSet": c.replica_set,
        "tls": c.tls,
        "readOnly": c.read_only,
        "sshEnabled": c.ssh_enabled,
        "sshHost": c.ssh_host,
        "sshPort": c.ssh_port,
        "sshAuthMethod": c.ssh_auth_method,
        "environment": c.environment,
        "secretsInKeychain": c.secrets_in_keychain,
        "lastConnectedAt": c.last_connected_at,
    })
}

/// Writes the bundle: `app.json`, the given logs, `connections.json` (redacted) and `settings-keys.json`
/// (names only — never values).
fn write_bundle<W: Write + Seek>(
    out: W,
    app: &AppInfo,
    logs: &[(String, Vec<u8>)],
    connections: &[SavedConnection],
    settings_keys: &[String],
) -> Result<(), AppError> {
    let mut zip = zip::ZipWriter::new(out);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: &[u8]| -> Result<(), AppError> {
        zip.start_file(name, opts).map_err(io)?;
        zip.write_all(bytes).map_err(io)
    };
    add("app.json", &serde_json::to_vec_pretty(app).map_err(io)?)?;
    for (name, bytes) in logs {
        add(&format!("logs/{name}"), redact_text(&String::from_utf8_lossy(bytes)).as_bytes())?;
    }
    let conns: Vec<Value> = connections.iter().map(redacted_connection).collect();
    add("connections.json", &serde_json::to_vec_pretty(&conns).map_err(io)?)?;
    let mut keys: Vec<&String> = settings_keys.iter().collect();
    keys.sort();
    keys.dedup();
    add("settings-keys.json", &serde_json::to_vec_pretty(&keys).map_err(io)?)?;
    zip.finish().map_err(io)?;
    Ok(())
}

/// The newest `n` log files in `dir` as (name, bytes), newest first.
fn newest_logs(dir: &Path, n: usize) -> Vec<(String, Vec<u8>)> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.starts_with("lumio") && n.ends_with(".log"))
        .collect();
    // `lumio.YYYY-MM-DD.log`: name order is date order.
    names.sort_by(|a, b| b.cmp(a));
    names.into_iter().take(n).filter_map(|name| std::fs::read(dir.join(&name)).ok().map(|b| (name, b))).collect()
}

/// Saves a diagnostics bundle to `path`. `settings_keys` are the names of stored settings (no values).
#[tauri::command]
pub fn export_diagnostics(app: AppHandle, path: String, settings_keys: Vec<String>) -> Result<(), AppError> {
    let connections = registry::load(&crate::commands::connection::registry_path(&app)?).unwrap_or_default();
    let logs = logging::log_dir().map(|d| newest_logs(d, BUNDLE_LOG_FILES)).unwrap_or_default();
    let file = std::fs::File::create(&path).map_err(io)?;
    write_bundle(file, &build_info(tauri::webview_version().ok()), &logs, &connections, &settings_keys)?;
    tracing::info!("diagnostics bundle exported");
    Ok(())
}

fn crash_dir() -> Result<PathBuf, AppError> {
    logging::log_dir().map(logging::crash_dir).ok_or_else(|| AppError::Io("logging is not initialised".into()))
}

/// Crash reports written since the last call; each is moved to `crash/seen/` once returned.
#[tauri::command]
pub fn take_crash_reports() -> Result<Vec<CrashReport>, AppError> {
    logging::take_crash_reports(&crash_dir()?).map_err(io)
}

/// Opens the crash report folder in the system file manager.
#[tauri::command]
pub fn open_crash_folder() -> Result<(), AppError> {
    let dir = crash_dir()?;
    std::fs::create_dir_all(&dir).map_err(io)?;
    let opener = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener).arg(&dir).spawn().map(|_| ()).map_err(io)
}

/// Development aid: panics so the crash-report path can be exercised end to end. Debug builds only.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_panic() {
    panic!("debug_panic: simulated panic");
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};

    #[test]
    fn diagnostics_zip_contains_no_enc_fields() {
        let mut c = registry::tests::conn(1);
        c.host = "db.example.com".into();
        c.user = "admin".into();
        c.password_enc = "SECRETPASSWORD".into();
        c.ssh_password_enc = "SECRETSSH".into();
        c.ssh_passphrase_enc = "SECRETPASS".into();
        c.tls_certificate_key_file_password_enc = "SECRETTLS".into();
        c.uri = Some("mongodb://admin:SECRETURI@db.example.com".into());
        c.environment = "prod".into();
        let app = build_info(Some("1.0".into()));
        let logs = vec![("lumio.2026-10-20.log".to_string(), b"connect mongodb://u:SECRETLOG@h failed".to_vec())];
        let mut buf = Cursor::new(Vec::new());
        write_bundle(&mut buf, &app, &logs, &[c], &["theme".into(), "api-token".into()]).unwrap();

        let mut zip = zip::ZipArchive::new(Cursor::new(buf.into_inner())).unwrap();
        let mut all = String::new();
        let names: Vec<String> = zip.file_names().filter_map(|n| n.ok().map(|c| c.into_owned())).collect();
        for name in &names {
            zip.by_name(name).unwrap().read_to_string(&mut all).unwrap();
        }
        assert!(["app.json", "connections.json", "settings-keys.json", "logs/lumio.2026-10-20.log"].iter().all(|n| names.iter().any(|x| x == n)));
        assert!(!all.contains("Enc\""), "no *Enc field names");
        assert!(!all.contains("_enc"));
        for secret in ["SECRETPASSWORD", "SECRETSSH", "SECRETPASS", "SECRETTLS", "SECRETURI", "SECRETLOG"] {
            assert!(!all.contains(secret), "{secret} leaked");
        }
        assert!(all.contains("db.example.com") && all.contains("prod"));
        assert!(all.contains("api-token"), "setting names are listed; values never are");
    }
}
