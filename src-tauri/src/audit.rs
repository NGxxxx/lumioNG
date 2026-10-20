//! Append-only, hash-chained audit log of write operations.
//!
//! One JSON object per line in `audit-YYYY-MM.jsonl` (UTC month) inside the app data dir. Every line
//! carries `prev_hash`, the SHA-256 of the previous line's exact bytes (without the newline), so an
//! edited or removed line shows up as a broken link. The first line of a month chains from the last
//! line of the previous month's file when that exists, otherwise from 64 zeros.
//!
//! Records are written from Rust at the write points (never trusted from the frontend) and contain
//! no customer data: filters go through [`redact_filter`], error text through `redact::redact_text`.
//! Callers other than the UI (script engine, MCP, import, and later data sync) use the same
//! [`AuditLog::record`] with their own `source`.

use crate::error::AppError;
use mongodb::bson::{Bson, Document};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// `prev_hash` of the very first line ever written.
pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_ERROR_CHARS: usize = 500;
/// Upper bound on the entries one `audit_query` returns (newest kept).
pub const MAX_QUERY_ENTRIES: usize = 20_000;

pub const SOURCE_UI: &str = "ui";
pub const SOURCE_SCRIPT: &str = "script";
pub const SOURCE_MCP: &str = "mcp";
pub const SOURCE_IMPORT: &str = "import";
/// Used by data sync (unit 14).
#[allow(dead_code)]
pub const SOURCE_SYNC: &str = "sync";

/// Which environments get audited (decision D5): PROD only by default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditScope {
    #[default]
    Prod,
    StagingProd,
    All,
}

impl AuditScope {
    pub fn includes(self, environment: &str) -> bool {
        match self {
            AuditScope::Prod => environment == "prod",
            AuditScope::StagingProd => environment == "prod" || environment == "staging",
            AuditScope::All => true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Epoch milliseconds; `record` fills it when 0.
    #[serde(default)]
    pub ts: i64,
    #[serde(default)]
    pub os_user: String,
    #[serde(default)]
    pub app_version: String,
    pub session_label: String,
    pub environment: String,
    pub op: String,
    pub ns: String,
    /// The filter with every string value replaced by `"<str:N>"`; `None` when the op has no filter.
    #[serde(default)]
    pub filter_redacted: Option<Value>,
    #[serde(default)]
    pub count: Option<u64>,
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
    /// "ui" | "script" | "mcp" | "import" | "sync"
    pub source: String,
    /// Set by `record`; whatever the caller puts here is ignored.
    #[serde(default)]
    pub prev_hash: String,
}

impl AuditEntry {
    /// A successful entry with no filter or count; chain the `with_*` helpers to fill the rest.
    pub fn new(source: &str, op: &str, ns: &str) -> Self {
        AuditEntry {
            ts: 0,
            os_user: String::new(),
            app_version: String::new(),
            session_label: String::new(),
            environment: String::new(),
            op: op.to_string(),
            ns: ns.to_string(),
            filter_redacted: None,
            count: None,
            ok: true,
            error: None,
            source: source.to_string(),
            prev_hash: String::new(),
        }
    }

    pub fn with_session(mut self, label: &str, environment: &str) -> Self {
        self.session_label = label.to_string();
        self.environment = environment.to_string();
        self
    }

    pub fn with_filter(mut self, filter: Option<&Document>) -> Self {
        self.filter_redacted = filter.map(|f| Bson::Document(redact_filter(f)).into_relaxed_extjson());
        self
    }

    pub fn with_count(mut self, count: Option<u64>) -> Self {
        self.count = count;
        self
    }

    /// Marks the entry failed. `summary` must be a structured, value-free description such as
    /// `11000 DuplicateKey` (see [`AuditError`]); free server text is never recorded because it
    /// can embed customer data (`dup key: { email: ... }`, validation `details`).
    pub fn with_error(mut self, summary: &str) -> Self {
        self.ok = false;
        self.error = Some(clip(&crate::redact::redact_text(summary), MAX_ERROR_CHARS));
        self
    }
}

/// A value-free description of a failure for the audit log.
pub trait AuditError {
    fn audit_summary(&self) -> String;
}

impl AuditError for AppError {
    /// `AppError` kind, plus the server code and codeName for server errors (`11000 DuplicateKey`).
    /// The message text is never used.
    fn audit_summary(&self) -> String {
        match self {
            AppError::Server { code, code_name, .. } if code_name.is_empty() => format!("{code}"),
            AppError::Server { code, code_name, .. } => format!("{code} {code_name}"),
            AppError::Connection(_) => "Connection".into(),
            AppError::SshTunnel(_) => "SshTunnel".into(),
            AppError::Query(_) => "Query".into(),
            AppError::Serialize(_) => "Serialize".into(),
            AppError::Parse(_) => "Parse".into(),
            AppError::Io(_) => "Io".into(),
            AppError::Vault(_) => "Vault".into(),
            AppError::NotConnected => "NotConnected".into(),
        }
    }
}

/// Destination of a pipeline that writes: `("aggregate:$out" | "aggregate:$merge", "db.coll")`.
/// `db`/`coll` are the source namespace, used when the stage names only a collection.
pub fn pipeline_write_target(pipeline: &[Document], db: &str, coll: &str) -> Option<(&'static str, String)> {
    let _ = coll;
    for stage in pipeline.iter().rev() {
        for (key, op) in [("$out", "aggregate:$out"), ("$merge", "aggregate:$merge")] {
            let Some(spec) = stage.get(key) else { continue };
            let target = if key == "$merge" {
                match spec {
                    Bson::Document(d) => d.get("into").cloned().unwrap_or(Bson::Null),
                    other => other.clone(),
                }
            } else {
                spec.clone()
            };
            let (tdb, tcoll) = match &target {
                Bson::String(c) => (db.to_string(), c.clone()),
                Bson::Document(d) => (d.get_str("db").unwrap_or(db).to_string(), d.get_str("coll").unwrap_or("?").to_string()),
                _ => (db.to_string(), "?".to_string()),
            };
            return Some((op, format!("{tdb}.{tcoll}")));
        }
    }
    None
}

fn clip(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// Replaces every string value with `"<str:N>"` (N = char count), recursing through documents and
/// arrays. Keys — field names and `$operators` — are kept, as are numbers, booleans, ObjectIds and
/// dates, so the shape of the filter stays readable without recording customer data.
pub fn redact_filter(filter: &Document) -> Document {
    filter.iter().map(|(k, v)| (k.clone(), redact_value(v))).collect()
}

fn redact_value(v: &Bson) -> Bson {
    match v {
        Bson::String(s) => Bson::String(format!("<str:{}>", s.chars().count())),
        Bson::Document(d) => Bson::Document(redact_filter(d)),
        Bson::Array(items) => Bson::Array(items.iter().map(redact_value).collect()),
        Bson::RegularExpression(r) => Bson::String(format!("<regex:{}>", r.pattern.chars().count())),
        Bson::Symbol(s) | Bson::JavaScriptCode(s) => Bson::String(format!("<str:{}>", s.chars().count())),
        Bson::JavaScriptCodeWithScope(c) => Bson::String(format!("<str:{}>", c.code.chars().count())),
        Bson::Binary(b) => Bson::String(format!("<bin:{}>", b.bytes.len())),
        other => other.clone(),
    }
}

// ── time ──

/// (year, month) in UTC for an epoch-millisecond timestamp (Hinnant's civil-from-days).
pub fn year_month(ts_ms: i64) -> (i32, u32) {
    let days = ts_ms.div_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    ((if m <= 2 { y + 1 } else { y }) as i32, m as u32)
}

fn file_name(year: i32, month: u32) -> String {
    format!("audit-{year:04}-{month:02}.jsonl")
}

#[cfg(test)]
fn previous_month(year: i32, month: u32) -> (i32, u32) {
    if month == 1 { (year - 1, 12) } else { (year, month - 1) }
}

/// `audit-2026-03.jsonl` → (2026, 3).
fn parse_file_name(name: &str) -> Option<(i32, u32)> {
    let rest = name.strip_prefix("audit-")?.strip_suffix(".jsonl")?;
    let (y, m) = rest.split_once('-')?;
    let (y, m) = (y.parse::<i32>().ok()?, m.parse::<u32>().ok()?);
    (1..=12).contains(&m).then_some((y, m))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The OS account name from the environment; no dependency needed for this.
pub fn os_user() -> String {
    for key in ["USERNAME", "USER"] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                return v;
            }
        }
    }
    "unknown".to_string()
}

fn hash_line(line: &str) -> String {
    format!("{:x}", Sha256::digest(line.as_bytes()))
}

fn io_err(e: std::io::Error) -> AppError {
    AppError::Io(format!("audit log: {e}"))
}

// ── the log ──

struct Inner {
    dir: Option<PathBuf>,
    scope: AuditScope,
    /// Hash of the last line written to `file` — saves re-reading the file for every record.
    head: Option<(PathBuf, String)>,
}

/// Cheap to clone (shared state); lives in `AppState` and is handed to the script engine.
#[derive(Clone)]
pub struct AuditLog {
    inner: Arc<Mutex<Inner>>,
}

impl Default for AuditLog {
    fn default() -> Self {
        AuditLog { inner: Arc::new(Mutex::new(Inner { dir: None, scope: AuditScope::default(), head: None })) }
    }
}

impl AuditLog {
    #[allow(dead_code)] // tests and later callers
    pub fn new(dir: PathBuf) -> Self {
        let log = AuditLog::default();
        log.set_dir(dir);
        log
    }

    pub fn set_dir(&self, dir: PathBuf) {
        let mut g = self.lock();
        g.dir = Some(dir);
        g.head = None;
    }

    pub fn dir(&self) -> Option<PathBuf> {
        self.lock().dir.clone()
    }

    pub fn set_scope(&self, scope: AuditScope) {
        self.lock().scope = scope;
    }

    #[allow(dead_code)] // tests and later callers
    pub fn scope(&self) -> AuditScope {
        self.lock().scope
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A panic while holding the lock cannot leave `Inner` half-updated in a harmful way.
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Appends `e` (after filling `ts`, `os_user`, `app_version`, `prev_hash`). An entry outside the
    /// configured scope is dropped silently (`Ok`). Before the data dir is known it is dropped too.
    pub fn record(&self, mut e: AuditEntry) -> Result<(), AppError> {
        let mut g = self.lock();
        if !g.scope.includes(&e.environment) {
            return Ok(());
        }
        let Some(dir) = g.dir.clone() else { return Ok(()) };
        if e.ts == 0 {
            e.ts = now_ms();
        }
        if e.os_user.is_empty() {
            e.os_user = os_user();
        }
        if e.app_version.is_empty() {
            e.app_version = env!("CARGO_PKG_VERSION").to_string();
        }
        let (y, m) = year_month(e.ts);
        let path = dir.join(file_name(y, m));
        std::fs::create_dir_all(&dir).map_err(io_err)?;

        let prev = match &g.head {
            Some((p, h)) if *p == path => h.clone(),
            _ => head_hash(&dir, &path)?,
        };
        e.prev_hash = prev;
        let line = serde_json::to_string(&e).map_err(|err| AppError::Serialize(err.to_string()))?;
        let result = append_line(&path, &line, g.head.as_ref().is_some_and(|(p, _)| *p == path));
        match result {
            Ok(()) => g.head = Some((path, hash_line(&line))),
            Err(err) => {
                g.head = None; // the file may now end mid-line; the next record re-reads it
                return Err(err);
            }
        }
        Ok(())
    }

    /// Entries with `from_ms <= ts <= to_ms`, optionally of one environment, newest first, capped.
    pub fn query(&self, from_ms: i64, to_ms: i64, environment: Option<&str>) -> Result<Vec<AuditEntry>, AppError> {
        let Some(dir) = self.dir() else { return Ok(Vec::new()) };
        let (fy, fm) = year_month(from_ms);
        let (ty, tm) = year_month(to_ms);
        let mut out = Vec::new();
        for (path, (y, m)) in list_files(&dir)? {
            if (y, m) < (fy, fm) || (y, m) > (ty, tm) {
                continue;
            }
            let text = std::fs::read_to_string(&path).map_err(io_err)?;
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let Ok(e) = serde_json::from_str::<AuditEntry>(line) else { continue };
                if e.ts >= from_ms && e.ts <= to_ms && environment.is_none_or(|env| e.environment == env) {
                    out.push(e);
                }
            }
        }
        // Newest first; the stable sort keeps later lines first among equal timestamps.
        out.reverse();
        out.sort_by_key(|e| std::cmp::Reverse(e.ts));
        out.truncate(MAX_QUERY_ENTRIES);
        Ok(out)
    }

    /// Verifies every audit file in the data dir, including the link between consecutive months.
    pub fn verify(&self) -> Result<VerifyReport, AppError> {
        match self.dir() {
            Some(dir) => verify_dir(&dir),
            None => Ok(VerifyReport::ok(0, 0)),
        }
    }

    /// Concatenates all audit files (JSONL, chain intact and still verifiable) into `dest`.
    pub fn export(&self, dest: &Path) -> Result<u64, AppError> {
        let Some(dir) = self.dir() else { return Ok(0) };
        let mut out = std::fs::File::create(dest).map_err(io_err)?;
        let mut lines = 0u64;
        for (path, _) in list_files(&dir)? {
            let text = std::fs::read_to_string(&path).map_err(io_err)?;
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                out.write_all(line.as_bytes()).and_then(|_| out.write_all(b"\n")).map_err(io_err)?;
                lines += 1;
            }
        }
        Ok(lines)
    }
}

/// Appends `line` + newline and syncs it to disk. Unless the head cache vouches that the file ends
/// cleanly, a missing final newline (a torn write) is repaired first so the fragment stays on its own line.
fn append_line(path: &Path, line: &str, file_known_clean: bool) -> Result<(), AppError> {
    let mut f = OpenOptions::new().create(true).append(true).read(true).open(path).map_err(io_err)?;
    let mut out = String::with_capacity(line.len() + 2);
    if !file_known_clean && ends_mid_line(&mut f)? {
        out.push('\n');
    }
    out.push_str(line);
    out.push('\n');
    // One write call per line keeps a line intact even if the app dies mid-record.
    f.write_all(out.as_bytes()).map_err(io_err)?;
    f.sync_data().map_err(io_err)
}

fn ends_mid_line(f: &mut std::fs::File) -> Result<bool, AppError> {
    use std::io::{Read, Seek, SeekFrom};
    let len = f.metadata().map_err(io_err)?.len();
    if len == 0 {
        return Ok(false);
    }
    f.seek(SeekFrom::Start(len - 1)).map_err(io_err)?;
    let mut b = [0u8; 1];
    f.read_exact(&mut b).map_err(io_err)?;
    Ok(b[0] != b'\n')
}

/// Hash of the last line of `text` that parses as an entry (a torn fragment does not count).
fn last_good_line_hash(text: &str) -> Option<String> {
    text.lines().rev().find(|l| serde_json::from_str::<AuditEntry>(l).is_ok()).map(hash_line)
}

/// `prev_hash` for the next line of `path`: the hash of its last complete line, else the last
/// complete line of the most recent earlier audit file (months with no activity are skipped), else zeros.
fn head_hash(dir: &Path, path: &Path) -> Result<String, AppError> {
    let read = |p: &Path| match std::fs::read_to_string(p) {
        Ok(t) => Ok(last_good_line_hash(&t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_err(e)),
    };
    if let Some(h) = read(path)? {
        return Ok(h);
    }
    let this = path.file_name().and_then(|n| n.to_str()).and_then(parse_file_name);
    for (p, ym) in list_files(dir)?.into_iter().rev() {
        if Some(ym) < this {
            if let Some(h) = read(&p)? {
                return Ok(h);
            }
        }
    }
    Ok(GENESIS_HASH.to_string())
}

/// An audit file and the (year, month) its name encodes.
type MonthFile = (PathBuf, (i32, u32));

fn list_files(dir: &Path) -> Result<Vec<MonthFile>, AppError> {
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io_err(e)),
    };
    let mut files: Vec<MonthFile> = rd
        .filter_map(Result::ok)
        .filter_map(|ent| {
            let ym = parse_file_name(&ent.file_name().to_string_lossy())?;
            Some((ent.path(), ym))
        })
        .collect();
    files.sort_by_key(|(_, ym)| *ym);
    Ok(files)
}

// ── verification ──

/// A line position: file name and 1-based line number.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LineRef {
    pub file: String,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub ok: bool,
    pub files: usize,
    pub lines: usize,
    /// File holding the first broken link.
    pub broken_file: Option<String>,
    /// 1-based number of the first line whose `prev_hash` does not match the line before it (or
    /// that is not valid JSON). The line just before it was edited, or lines were removed there.
    pub broken_line: Option<usize>,
    /// Half-written lines left by a crash or full disk. They are not tampering: the chain skips
    /// them and continues from the last complete line.
    pub torn: Vec<LineRef>,
}

impl VerifyReport {
    fn ok(files: usize, lines: usize) -> Self {
        VerifyReport { ok: true, files, lines, broken_file: None, broken_line: None, torn: Vec::new() }
    }

    fn broken(files: usize, lines: usize, file: &Path, line: usize) -> Self {
        VerifyReport {
            ok: false,
            files,
            lines,
            broken_file: file.file_name().map(|n| n.to_string_lossy().into_owned()),
            broken_line: Some(line),
            torn: Vec::new(),
        }
    }
}

fn file_label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Checks one file's chain; the first line's `prev_hash` is accepted as is (see `verify_dir` for the
/// link to the previous file).
#[allow(dead_code)] // single-file check, used by tests and export verification
pub fn verify_chain(path: &Path) -> Result<VerifyReport, AppError> {
    verify_file(path, None).map(|(r, _)| r)
}

/// Returns the report and the hash of the file's last good line (for linking the next file).
fn verify_file(path: &Path, expected_first: Option<&str>) -> Result<(VerifyReport, Option<String>), AppError> {
    let text = std::fs::read_to_string(path).map_err(io_err)?;
    let numbered: Vec<(usize, &str)> = text.lines().enumerate().map(|(i, l)| (i + 1, l)).filter(|(_, l)| !l.trim().is_empty()).collect();
    let mut expected: Option<String> = expected_first.map(str::to_string);
    let mut count = 0usize;
    let mut torn = Vec::new();
    for (pos, (no, line)) in numbered.iter().enumerate() {
        match serde_json::from_str::<AuditEntry>(line) {
            Ok(entry) => {
                if expected.as_ref().is_some_and(|want| &entry.prev_hash != want) {
                    return Ok((VerifyReport::broken(1, count + 1, path, *no), None));
                }
                count += 1;
                expected = Some(hash_line(line));
            }
            Err(_) => {
                // Unparseable: a torn write if it is the last line, or the next line chains straight
                // past it (the writer skipped the fragment); otherwise the line was damaged.
                let skipped = match numbered.get(pos + 1) {
                    None => true,
                    Some((_, next)) => serde_json::from_str::<AuditEntry>(next)
                        .is_ok_and(|n| expected.as_ref().is_none_or(|want| &n.prev_hash == want)),
                };
                if !skipped {
                    return Ok((VerifyReport::broken(1, count + 1, path, *no), None));
                }
                torn.push(LineRef { file: file_label(path), line: *no });
            }
        }
    }
    let mut report = VerifyReport::ok(1, count);
    report.torn = torn;
    Ok((report, expected))
}

/// Verifies every file, linking each to the last line of the file before it (whatever months lie between).
pub fn verify_dir(dir: &Path) -> Result<VerifyReport, AppError> {
    let files = list_files(dir)?;
    let mut total_lines = 0usize;
    let mut prev: Option<String> = None;
    let mut torn = Vec::new();
    for (idx, (path, _)) in files.iter().enumerate() {
        let (mut report, last) = verify_file(path, prev.as_deref())?;
        total_lines += report.lines;
        torn.append(&mut report.torn);
        if !report.ok {
            report.files = idx + 1;
            report.lines = total_lines;
            report.torn = torn;
            return Ok(report);
        }
        if last.is_some() {
            prev = last;
        }
    }
    let mut report = VerifyReport::ok(files.len(), total_lines);
    report.torn = torn;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId};

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lumiong_audit_{tag}_{}_{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(env: &str, ts: i64) -> AuditEntry {
        let mut e = AuditEntry::new(SOURCE_UI, "update_many", "shop.orders").with_session("Prod", env).with_count(Some(3));
        e.ts = ts;
        e
    }

    /// 2026-10-01T00:00:00Z
    const OCT: i64 = 1790812800000;

    fn only_file(dir: &Path) -> PathBuf {
        list_files(dir).unwrap().remove(0).0
    }

    #[test]
    fn chain_verifies_after_appends() {
        let dir = temp_dir("chain");
        let log = AuditLog::new(dir.clone());
        for i in 0..5 {
            log.record(entry("prod", OCT + i)).unwrap();
        }
        let path = only_file(&dir);
        assert!(path.file_name().unwrap().to_string_lossy().starts_with("audit-2026-10"));
        let r = verify_chain(&path).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(r.lines, 5);
        let text = std::fs::read_to_string(&path).unwrap();
        let first: AuditEntry = serde_json::from_str(text.lines().next().unwrap()).unwrap();
        assert_eq!(first.prev_hash, GENESIS_HASH);
        assert_eq!(first.app_version, env!("CARGO_PKG_VERSION"));
        assert!(!first.os_user.is_empty());
        // A fresh handle (new process) continues the same chain.
        let log2 = AuditLog::new(dir.clone());
        log2.record(entry("prod", OCT + 9)).unwrap();
        assert!(verify_dir(&dir).unwrap().ok);
        assert_eq!(verify_dir(&dir).unwrap().lines, 6);
    }

    #[test]
    fn edited_line_breaks_chain_at_that_line() {
        let dir = temp_dir("edit");
        let log = AuditLog::new(dir.clone());
        for i in 0..4 {
            log.record(entry("prod", OCT + i)).unwrap();
        }
        let path = only_file(&dir);
        let text = std::fs::read_to_string(&path).unwrap();
        let edited = text.replacen("\"count\":3", "\"count\":0", 1); // edits line 1 only
        assert_ne!(edited, text);
        std::fs::write(&path, edited).unwrap();
        let r = verify_chain(&path).unwrap();
        assert!(!r.ok);
        // Line 1 was edited, so line 2's prev_hash no longer matches: the break shows at line 2.
        assert_eq!(r.broken_line, Some(2));

        // Removing a line is caught as well.
        std::fs::write(&path, text.lines().enumerate().filter(|(i, _)| *i != 1).map(|(_, l)| format!("{l}\n")).collect::<String>()).unwrap();
        let r = verify_chain(&path).unwrap();
        assert!(!r.ok);
        assert_eq!(r.broken_line, Some(2));
    }

    #[test]
    fn month_rollover_chains_from_previous_file() {
        let dir = temp_dir("rollover");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT)).unwrap();
        log.record(entry("prod", OCT + 31 * 86_400_000)).unwrap(); // November
        let files = list_files(&dir).unwrap();
        assert_eq!(files.len(), 2);
        assert!(verify_dir(&dir).unwrap().ok);
        // Tampering with the October file is caught by the November link.
        let oct = &files[0].0;
        let text = std::fs::read_to_string(oct).unwrap();
        std::fs::write(oct, text.replace("\"count\":3", "\"count\":7")).unwrap();
        let r = verify_dir(&dir).unwrap();
        assert!(!r.ok);
        assert_eq!(r.broken_file.as_deref(), Some("audit-2026-11.jsonl"));
    }

    #[test]
    fn redact_filter_hides_string_values_keeps_operators() {
        let oid = ObjectId::new();
        let f = doc! {
            "email": "ann@example.com",
            "age": { "$gt": 30 },
            "$or": [ { "name": "Bo" }, { "tags": { "$in": ["a", "bcd"] } } ],
            "_id": oid,
            "nick": { "$regex": "^ab", "$options": "i" },
        };
        let r = redact_filter(&f);
        assert_eq!(r.get_str("email").unwrap(), "<str:15>");
        assert_eq!(r.get_document("age").unwrap(), &doc! { "$gt": 30 });
        assert_eq!(r.get_object_id("_id").unwrap(), oid);
        let or = r.get_array("$or").unwrap();
        assert_eq!(or[0].as_document().unwrap().get_str("name").unwrap(), "<str:2>");
        assert_eq!(or[1].as_document().unwrap().get_document("tags").unwrap().get_array("$in").unwrap(), &vec![Bson::String("<str:1>".into()), Bson::String("<str:3>".into())]);
        assert_eq!(r.get_document("nick").unwrap().get_str("$regex").unwrap(), "<str:3>");
        assert!(!format!("{r:?}").contains("example.com"));
    }

    #[test]
    fn writes_on_dev_are_skipped_when_scope_is_prod_only() {
        let dir = temp_dir("scope");
        let log = AuditLog::new(dir.clone());
        assert_eq!(log.scope(), AuditScope::Prod);
        log.record(entry("dev", OCT)).unwrap();
        log.record(entry("staging", OCT)).unwrap();
        log.record(entry("", OCT)).unwrap();
        assert!(list_files(&dir).unwrap().is_empty());
        log.record(entry("prod", OCT)).unwrap();
        assert_eq!(log.query(0, i64::MAX, None).unwrap().len(), 1);

        log.set_scope(AuditScope::StagingProd);
        log.record(entry("staging", OCT + 1)).unwrap();
        log.record(entry("dev", OCT + 2)).unwrap();
        assert_eq!(log.query(0, i64::MAX, None).unwrap().len(), 2);

        log.set_scope(AuditScope::All);
        log.record(entry("dev", OCT + 3)).unwrap();
        log.record(entry("", OCT + 4)).unwrap();
        let all = log.query(0, i64::MAX, None).unwrap();
        assert_eq!(all.len(), 4);
        assert_eq!(all[0].ts, OCT + 4); // newest first
        assert_eq!(log.query(0, i64::MAX, Some("staging")).unwrap().len(), 1);
        assert_eq!(log.query(OCT + 1, OCT + 3, None).unwrap().len(), 2);
        assert!(verify_dir(&dir).unwrap().ok);
    }

    #[test]
    fn failed_write_is_recorded_with_ok_false() {
        let dir = temp_dir("fail");
        let log = AuditLog::new(dir);
        let e = entry("prod", OCT).with_error("connect failed for mongodb://admin:s3cr3t@db:27017/app");
        log.record(e).unwrap();
        let got = log.query(0, i64::MAX, None).unwrap().remove(0);
        assert!(!got.ok);
        let err = got.error.unwrap();
        assert!(!err.contains("s3cr3t"), "{err}");
        assert!(err.contains("****"));
    }

    #[test]
    fn unset_dir_drops_records_and_export_keeps_chain() {
        let none = AuditLog::default();
        none.record(entry("prod", OCT)).unwrap();
        assert!(none.verify().unwrap().ok);

        let dir = temp_dir("export");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT)).unwrap();
        log.record(entry("prod", OCT + 1)).unwrap();
        let dest = dir.join("out.jsonl");
        assert_eq!(log.export(&dest).unwrap(), 2);
        assert!(verify_chain(&dest).unwrap().ok);
    }

    #[test]
    fn year_month_is_utc_calendar() {
        assert_eq!(year_month(0), (1970, 1));
        assert_eq!(year_month(OCT), (2026, 10));
        assert_eq!(year_month(OCT - 1), (2026, 9));
        assert_eq!(year_month(951_782_400_000), (2000, 2)); // 2000-02-29
        assert_eq!(year_month(-1), (1969, 12));
        assert_eq!(parse_file_name("audit-2026-03.jsonl"), Some((2026, 3)));
        assert_eq!(parse_file_name("audit-2026-13.jsonl"), None);
        assert_eq!(previous_month(2026, 1), (2025, 12));
    }

    // ── fix round 1 ──

    fn write_error(json: &str) -> AppError {
        use mongodb::error::{ErrorKind, WriteError, WriteFailure};
        let w: WriteError = serde_json::from_str(json).unwrap();
        AppError::from(mongodb::error::Error::from(ErrorKind::Write(WriteFailure::WriteError(w))))
    }

    #[test]
    fn duplicate_key_error_is_recorded_as_code_only_without_values() {
        let err = write_error(
            r#"{"code":11000,"codeName":"DuplicateKey","errmsg":"E11000 duplicate key error collection: shop.users index: email_1 dup key: { email: \"ann@example.com\" }"}"#,
        );
        assert!(err.to_string().contains("ann@example.com"), "the UI message keeps its detail");
        assert_eq!(err.audit_summary(), "11000 DuplicateKey");
        // Even a missing codeName still maps the well-known code.
        assert_eq!(write_error(r#"{"code":11000,"errmsg":"dup key: { email: \"ann@example.com\" }"}"#).audit_summary(), "11000 DuplicateKey");

        let dir = temp_dir("dupkey");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT).with_error(&err.audit_summary())).unwrap();
        let text = std::fs::read_to_string(only_file(&dir)).unwrap();
        assert!(!text.contains("ann@example.com") && !text.contains("email"), "{text}");
        assert!(text.contains("11000 DuplicateKey"));
    }

    #[test]
    fn validation_failure_is_recorded_as_code_only_without_considered_values() {
        let err = write_error(
            r#"{"code":121,"codeName":"DocumentValidationFailure","errmsg":"Document failed validation","errInfo":{"details":{"operatorName":"$jsonSchema","schemaRulesNotSatisfied":[{"propertyName":"email","details":[{"consideredValue":"secret@x.io"}]}]}}}"#,
        );
        assert_eq!(err.audit_summary(), "121 DocumentValidationFailure");
        let cmd = {
            use mongodb::error::{CommandError, ErrorKind};
            let c: CommandError = serde_json::from_str(r#"{"code":121,"codeName":"DocumentValidationFailure","errmsg":"Document failed validation: consideredValue secret@x.io"}"#).unwrap();
            AppError::from(mongodb::error::Error::from(ErrorKind::Command(c)))
        };
        assert_eq!(cmd.audit_summary(), "121 DocumentValidationFailure");
        let dir = temp_dir("validation");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT).with_error(&cmd.audit_summary())).unwrap();
        assert!(!std::fs::read_to_string(only_file(&dir)).unwrap().contains("secret@x.io"));
    }

    #[test]
    fn other_errors_are_recorded_by_kind_only() {
        assert_eq!(AppError::Query("name: \"Ann\"".into()).audit_summary(), "Query");
        assert_eq!(AppError::Io("C:/secret/path".into()).audit_summary(), "Io");
        assert_eq!(AppError::NotConnected.audit_summary(), "NotConnected");
    }

    #[test]
    fn aggregate_write_target_is_the_destination_namespace() {
        let st = |d: Document| vec![doc! { "$match": {} }, d];
        assert_eq!(pipeline_write_target(&st(doc! { "$out": "copy" }), "shop", "orders"), Some(("aggregate:$out", "shop.copy".into())));
        assert_eq!(pipeline_write_target(&st(doc! { "$out": { "db": "bk", "coll": "c2" } }), "shop", "orders"), Some(("aggregate:$out", "bk.c2".into())));
        assert_eq!(pipeline_write_target(&st(doc! { "$merge": "totals" }), "shop", "orders"), Some(("aggregate:$merge", "shop.totals".into())));
        assert_eq!(pipeline_write_target(&st(doc! { "$merge": { "into": { "db": "bk", "coll": "t" }, "on": "_id" } }), "shop", "orders"), Some(("aggregate:$merge", "bk.t".into())));
        assert_eq!(pipeline_write_target(&[doc! { "$match": {} }], "shop", "orders"), None);
    }

    #[tokio::test]
    async fn ui_aggregate_out_helper_records_one_line_against_the_destination() {
        // The UI command wraps its pipeline future in `AppState::audited` with this target.
        let dir = temp_dir("aggout");
        let state = crate::state::AppState::default();
        state.audit.set_dir(dir.clone());
        state.audit.set_scope(AuditScope::All);
        let (op, ns) = pipeline_write_target(&[doc! { "$out": "copy" }], "shop", "orders").unwrap();
        let r: Result<(), AppError> = state.audited("none", SOURCE_UI, op, &ns, None, |_| None, async { Ok(()) }).await;
        assert!(r.is_ok());
        let got = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!((got[0].op.as_str(), got[0].ns.as_str(), got[0].source.as_str()), ("aggregate:$out", "shop.copy", "ui"));
    }

    #[test]
    fn script_audit_records_aggregate_out_and_summarised_errors() {
        let dir = temp_dir("scriptout");
        let log = AuditLog::new(dir);
        log.set_scope(AuditScope::All);
        let sa = crate::script::host::ScriptAudit { log: log.clone(), label: "L".into(), environment: "dev".into() };
        let err = AppError::Query("dup key: { email: \"a@b.c\" }".into());
        sa.record("aggregate:$out", "bk.copy", None, &Err(&err));
        let got = log.query(0, i64::MAX, None).unwrap();
        assert_eq!((got[0].source.as_str(), got[0].op.as_str(), got[0].ns.as_str()), ("script", "aggregate:$out", "bk.copy"));
        assert_eq!(got[0].error.as_deref(), Some("Query"));
    }

    #[test]
    fn torn_line_is_isolated_reported_as_torn_and_the_chain_continues() {
        let dir = temp_dir("torn");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT)).unwrap();
        log.record(entry("prod", OCT + 1)).unwrap();
        let path = only_file(&dir);
        // A crash left half a line without its newline.
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(br#"{"ts":17908128000"#).unwrap();
        drop(f);
        let r = verify_dir(&dir).unwrap();
        assert!(r.ok, "a trailing fragment is torn, not tampering: {r:?}");
        assert_eq!(r.torn, vec![LineRef { file: file_label(&path), line: 3 }]);

        // A new process appends: the fragment keeps its own line and the chain skips it.
        let log2 = AuditLog::new(dir.clone());
        log2.record(entry("prod", OCT + 2)).unwrap();
        log2.record(entry("prod", OCT + 3)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 5);
        assert!(text.lines().nth(2).unwrap().starts_with(r#"{"ts":17908128000"#));
        let r = verify_dir(&dir).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!((r.lines, r.torn.len()), (4, 1));

        // Real tampering next to it is still caught.
        std::fs::write(&path, text.replacen("\"count\":3", "\"count\":9", 1)).unwrap();
        let r = verify_dir(&dir).unwrap();
        assert!(!r.ok);
        assert_eq!(r.broken_line, Some(2));
    }

    #[test]
    fn chain_links_across_a_missing_month() {
        let dir = temp_dir("gap");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT)).unwrap();
        log.record(entry("prod", OCT + 62 * 86_400_000)).unwrap(); // December; November has no file
        let files = list_files(&dir).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[1].1, (2026, 12));
        let dec: AuditEntry = serde_json::from_str(std::fs::read_to_string(&files[1].0).unwrap().lines().next().unwrap()).unwrap();
        assert_ne!(dec.prev_hash, GENESIS_HASH, "December chains from October");
        assert!(verify_dir(&dir).unwrap().ok);
        // Tampering with October is caught through the December link.
        let text = std::fs::read_to_string(&files[0].0).unwrap();
        std::fs::write(&files[0].0, text.replace("\"count\":3", "\"count\":4")).unwrap();
        let r = verify_dir(&dir).unwrap();
        assert!(!r.ok);
        assert_eq!(r.broken_file.as_deref(), Some("audit-2026-12.jsonl"));
    }

    #[test]
    fn the_head_cache_avoids_rereading_the_file_per_record() {
        let dir = temp_dir("cache");
        let log = AuditLog::new(dir.clone());
        log.record(entry("prod", OCT)).unwrap();
        let path = only_file(&dir);
        // Replace the file's content behind the cache's back: the next record chains from the cached
        // head (proving no re-read happened); a re-read would have found no valid line and used zeros.
        std::fs::write(&path, "garbage\n").unwrap();
        log.record(entry("prod", OCT + 1)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let second: AuditEntry = serde_json::from_str(text.lines().nth(1).unwrap()).unwrap();
        assert_ne!(second.prev_hash, GENESIS_HASH);
    }
}
