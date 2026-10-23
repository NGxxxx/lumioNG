//! Structured file logging and local crash reports.
//!
//! Logs go to a daily-rotated file in the app log directory (7 files kept). A panic hook writes the
//! panic message and a backtrace to `crash/crash-<epoch_ms>.txt` next to them; nothing is ever sent
//! anywhere. All text is passed through `redact::redact_text` first.
use crate::redact::redact_text;
use crate::util::now_ms;
use serde::Serialize;
use std::backtrace::Backtrace;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tracing_appender::non_blocking::WorkerGuard;

const LOG_PREFIX: &str = "lumio";
const LOG_SUFFIX: &str = "log";
const KEEP_LOG_FILES: usize = 7;
const CRASH_DIR: &str = "crash";
const SEEN_DIR: &str = "seen";

static GUARD: OnceLock<WorkerGuard> = OnceLock::new();
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Starts the file logger and installs the crash-report panic hook. Safe to call once; failures
/// (read-only disk, ...) leave the app running without file logging.
pub fn init(log_dir: PathBuf) {
    if LOG_DIR.set(log_dir.clone()).is_err() {
        return;
    }
    if std::fs::create_dir_all(&log_dir).is_ok() {
        let appender = tracing_appender::rolling::Builder::new()
            .rotation(tracing_appender::rolling::Rotation::DAILY)
            .filename_prefix(LOG_PREFIX)
            .filename_suffix(LOG_SUFFIX)
            .max_log_files(KEEP_LOG_FILES)
            .build(&log_dir);
        if let Ok(appender) = appender {
            let (writer, guard) = tracing_appender::non_blocking(appender);
            let _ = GUARD.set(guard);
            let _ = tracing_subscriber::fmt()
                .with_writer(writer)
                .with_ansi(false)
                .with_max_level(tracing::Level::INFO)
                .try_init();
        }
    }
    install_panic_hook(log_dir.join(CRASH_DIR));
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "LumioNG started");
}

/// The app log directory once `init` ran.
pub fn log_dir() -> Option<&'static Path> {
    LOG_DIR.get().map(PathBuf::as_path)
}

pub fn crash_dir(log_dir: &Path) -> PathBuf {
    log_dir.join(CRASH_DIR)
}

/// `crash-<epoch_ms>.txt`, zero-padded so names sort in time order.
pub fn crash_file_name(epoch_ms: i64) -> String {
    format!("crash-{epoch_ms:015}.txt")
}

fn crash_epoch_ms(name: &str) -> Option<i64> {
    name.strip_prefix("crash-")?.strip_suffix(".txt")?.parse().ok()
}

/// The report body: version, then the panic message and backtrace, redacted.
pub fn crash_text(version: &str, message: &str, backtrace: &str) -> String {
    redact_text(&format!("LumioNG {version}\n\n{message}\n\nBacktrace:\n{backtrace}\n"))
}

thread_local! {
    /// Depth of `catch_unwind` scopes on this thread whose panics are handled (turned into errors).
    static CAUGHT_SCOPES: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// While alive, panics on this thread are logged but produce no crash report: the code around it
/// recovers via `catch_unwind` (e.g. the script engine), so the app did not actually die.
pub struct CaughtPanicScope(());

impl CaughtPanicScope {
    pub fn enter() -> Self {
        CAUGHT_SCOPES.with(|c| c.set(c.get() + 1));
        CaughtPanicScope(())
    }
}

impl Drop for CaughtPanicScope {
    fn drop(&mut self) {
        CAUGHT_SCOPES.with(|c| c.set(c.get().saturating_sub(1)));
    }
}

/// Writes the crash report for a panic unless it happens inside a `CaughtPanicScope`.
fn record_panic(crash_dir: &Path, epoch_ms: i64, message: &str, backtrace: impl FnOnce() -> String) -> Option<PathBuf> {
    if CAUGHT_SCOPES.with(|c| c.get()) > 0 {
        return None;
    }
    let text = crash_text(env!("CARGO_PKG_VERSION"), message, &backtrace());
    std::fs::create_dir_all(crash_dir).ok()?;
    let path = crash_dir.join(crash_file_name(epoch_ms));
    std::fs::write(&path, text).ok()?;
    Some(path)
}

fn install_panic_hook(crash_dir: PathBuf) {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info.to_string();
        tracing::error!(panic = %redact_text(&message), "panic");
        record_panic(&crash_dir, now_ms(), &message, || Backtrace::force_capture().to_string());
        default_hook(info);
    }));
}

/// One unseen crash report, as handed to the frontend.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    /// Path of the report file (inside `crash/seen/` once returned).
    pub file: String,
    pub created_ms: u64,
    /// The panic message line.
    pub summary: String,
}

fn summary_of(text: &str) -> String {
    // After the version line and a blank line comes the panic message (location, then text) up to the next blank line.
    let lines = text.lines().skip(1).skip_while(|l| l.trim().is_empty()).take_while(|l| !l.trim().is_empty());
    lines.collect::<Vec<_>>().join(" ").chars().take(300).collect()
}

/// Reads every unseen report in `crash_dir` (oldest first) and moves each to `crash_dir/seen/`.
pub fn take_crash_reports(crash_dir: &Path) -> std::io::Result<Vec<CrashReport>> {
    let Ok(entries) = std::fs::read_dir(crash_dir) else { return Ok(Vec::new()) };
    let mut names: Vec<(i64, String)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            Some((crash_epoch_ms(&name)?, name))
        })
        .collect();
    names.sort();
    let seen = crash_dir.join(SEEN_DIR);
    let mut out = Vec::new();
    for (ms, name) in names {
        let from = crash_dir.join(&name);
        let text = std::fs::read_to_string(&from).unwrap_or_default();
        std::fs::create_dir_all(&seen)?;
        let to = seen.join(&name);
        std::fs::rename(&from, &to)?;
        out.push(CrashReport { file: to.to_string_lossy().into_owned(), created_ms: ms as u64, summary: summary_of(&text) });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lumiong_logging_{tag}_{}_{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn crash_file_name_is_sortable() {
        let a = crash_file_name(999);
        let b = crash_file_name(1_000);
        let c = crash_file_name(1_700_000_000_000);
        assert!(a < b && b < c);
        assert_eq!(crash_epoch_ms(&c), Some(1_700_000_000_000));
        assert_eq!(crash_epoch_ms("notes.txt"), None);
    }

    #[test]
    fn take_moves_reports_to_seen() {
        let dir = temp_dir("take");
        std::fs::write(dir.join(crash_file_name(2_000)), crash_text("1.0", "panicked at b.rs:1:1:\nsecond", "bt")).unwrap();
        std::fs::write(dir.join(crash_file_name(1_000)), crash_text("1.0", "panicked at a.rs:1:1:\nfirst", "bt")).unwrap();
        std::fs::write(dir.join("unrelated.txt"), "x").unwrap();

        let reports = take_crash_reports(&dir).unwrap();
        assert_eq!(reports.iter().map(|r| r.created_ms).collect::<Vec<_>>(), vec![1_000, 2_000]);
        assert_eq!(reports[0].summary, "panicked at a.rs:1:1: first");
        assert!(reports[0].file.contains("seen"));
        assert!(Path::new(&reports[0].file).exists());
        assert!(dir.join("unrelated.txt").exists());
        // A second call finds nothing new.
        assert!(take_crash_reports(&dir).unwrap().is_empty());
        assert!(take_crash_reports(&dir.join("missing")).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn caught_panic_scope_suppresses_the_crash_report() {
        let dir = temp_dir("caught");
        {
            let _outer = CaughtPanicScope::enter();
            let _inner = CaughtPanicScope::enter();
            assert!(record_panic(&dir, 1, "panicked at a.rs", || "bt".into()).is_none());
        }
        assert!(!dir.join(crash_file_name(1)).exists());
        // Dropping the scopes re-enables reports.
        let path = record_panic(&dir, 2, "panicked at b.rs", || "bt".into()).expect("report written");
        assert!(path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn crash_text_is_redacted() {
        let text = crash_text("0.6.0", "panicked at x.rs: bad uri mongodb://u:hunter2@h/db Bearer abc.def", "frame");
        assert!(!text.contains("hunter2"));
        assert!(!text.contains("abc.def"));
        assert!(text.starts_with("LumioNG 0.6.0"));
        assert!(text.contains("mongodb://u:****@h/db"));
    }
}
