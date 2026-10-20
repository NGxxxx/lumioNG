//! QuickJS host context and global function bindings for the script engine; `bind(ctx, host)` registers all `__xxx` globals the JS prelude calls. Bindings are split by concern: [`read`] (find/aggregate/count/distinct/listCollections/cursor paging), [`write`] (`__write`), and [`admin`] (`__runCommand`/`__adminCommand`).
pub mod admin;
pub mod read;
pub mod write;

use crate::script::cursors::CursorStore;
use crate::script::outcome::ConsoleEntry;
use mongodb::{bson::Document, Client};
use rquickjs::{Ctx, Exception, Function, Result as JsResult};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Handle;

// ── with_interrupt ────────────────────────────────────────────────────────────

/// Race a driver future against the cancel flag and a deadline, polling every 50ms since the future itself isn't pollable for cancellation.
pub(crate) async fn with_interrupt<T>(
    cancel: Arc<AtomicBool>,
    deadline: Instant,
    fut: impl std::future::Future<Output = Result<T, crate::error::AppError>>,
) -> Result<T, crate::error::AppError> {
    tokio::pin!(fut);
    loop {
        tokio::select! {
            r = &mut fut => return r,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                if cancel.load(Ordering::Relaxed) {
                    return Err(crate::error::AppError::Query("Operation cancelled".into()));
                }
                if Instant::now() >= deadline {
                    return Err(crate::error::AppError::Query("Operation timed out".into()));
                }
            }
        }
    }
}

// ── Audit ────────────────────────────────────────────────────────────────────

/// Where a script's writes are recorded: the shared audit log plus the session's label/environment
/// at the time the script started.
#[derive(Clone)]
pub struct ScriptAudit {
    pub log: crate::audit::AuditLog,
    pub label: String,
    pub environment: String,
}

impl ScriptAudit {
    /// One audit line (source `script`) for a write the script ran; never fails the script.
    pub fn record(&self, op: &str, ns: &str, filter: Option<&Document>, outcome: &Result<Option<u64>, &crate::error::AppError>) {
        let entry = crate::audit::AuditEntry::new(crate::audit::SOURCE_SCRIPT, op, ns)
            .with_session(&self.label, &self.environment)
            .with_filter(filter);
        let entry = match outcome {
            Ok(count) => entry.with_count(*count),
            Err(e) => entry.with_error(&crate::audit::AuditError::audit_summary(*e)),
        };
        if let Err(e) = self.log.record(entry) {
            tracing::error!("audit log write failed: {e}");
        }
    }
}

/// Records `outcome` when the host context carries an audit sink.
pub(crate) fn audit_write(
    h: &HostCtx,
    op: &str,
    ns: &str,
    filter: Option<&Document>,
    outcome: &Result<Option<u64>, &crate::error::AppError>,
) {
    if let Some(a) = &h.audit {
        a.record(op, ns, filter, outcome);
    }
}

// ── HostCtx ──────────────────────────────────────────────────────────────────

/// Shared context passed into every host function closure; `Rc`-based since QuickJS is single-threaded and all host fn calls happen on the same worker thread.
#[derive(Clone)]
pub struct HostCtx {
    pub client: Client,
    pub handle: Handle,
    pub console: Rc<RefCell<Vec<ConsoleEntry>>>,
    pub cursors: Rc<RefCell<CursorStore>>,
    /// Maximum number of rows returned per cursor open (cap for result display). `0` = unlimited.
    pub cap: usize,
    /// When true, write/DDL host paths reject the operation.
    pub read_only: bool,
    /// Cancel flag shared with the interrupt handler; set to true to abort in-flight ops.
    pub cancel: Arc<AtomicBool>,
    /// Absolute deadline for all DB operations in this script run.
    pub deadline: Instant,
    /// Where write ops are audited; `None` in tests that don't care.
    pub audit: Option<ScriptAudit>,
}

// ── Error helper ─────────────────────────────────────────────────────────────

/// Convert any displayable error into a thrown JS exception.
fn to_js_err<'js>(ctx: &Ctx<'js>, e: impl ToString) -> rquickjs::Error {
    Exception::throw_message(ctx, &e.to_string())
}

/// Shared tail of every `bind_*` host function: runs a DB future on this blocking thread, racing it against `h`'s cancel flag/deadline.
fn run_blocking<'js, T>(
    h: HostCtx,
    ctx: &Ctx<'js>,
    fut: impl std::future::Future<Output = Result<T, crate::error::AppError>>,
) -> JsResult<T> {
    let cancel = h.cancel.clone();
    let deadline = h.deadline;
    h.handle
        .block_on(with_interrupt(cancel, deadline, fut))
        .map_err(|e| to_js_err(ctx, e))
}

// ── Write-command denylist ────────────────────────────────────────────────────

/// Top-level write/DDL command names (lowercased). Anything else is treated as a read/admin-read.
const WRITE_COMMANDS: &[&str] = &[
    "insert", "update", "delete", "findandmodify",
    "drop", "dropdatabase", "create", "renamecollection",
    "createindexes", "dropindexes", "collmod",
    "createuser", "dropuser", "dropallusersfromdatabase", "updateuser",
    "grantrolestouser", "revokerolesfromuser",
    "createrole", "droprole", "dropallrolesfromdatabase", "updaterole",
    "grantprivilegestorole", "revokeprivilegesfromrole",
    "grantrolestorole", "revokerolesfromrole",
    "createcollection", "createview", "createindex", "reindex",
];

/// True if the command document's first key is a known write/DDL command (case-insensitive).
pub(crate) fn is_write_command(cmd: &Document) -> bool {
    cmd.keys()
        .next()
        .map(|k| WRITE_COMMANDS.contains(&k.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// True if an aggregation pipeline writes to a collection: any `$out` or `$merge` stage (scanned defensively, though server rules require them last).
pub(crate) fn pipeline_writes(pipeline: &[Document]) -> bool {
    pipeline.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge"))
}

// ── bind ─────────────────────────────────────────────────────────────────────

/// Register all `__xxx` globals into `ctx`.
pub fn bind(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    read::bind_find(ctx, host.clone())?;
    read::bind_aggregate(ctx, host.clone())?;
    read::bind_count(ctx, host.clone())?;
    read::bind_distinct(ctx, host.clone())?;
    write::bind_write(ctx, host.clone())?;
    admin::bind_run_command(ctx, host.clone())?;
    admin::bind_admin_command(ctx, host.clone())?;
    read::bind_list_collections(ctx, host.clone())?;
    read::bind_cursor_fetch(ctx, host.clone())?;
    read::bind_cursor_close(ctx, host.clone())?;
    bind_print(ctx, host)?;
    Ok(())
}

// ── __print ───────────────────────────────────────────────────────────────────

fn bind_print(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: level ("log" | "error"), text
    let f = Function::new(
        ctx.clone(),
        move |_ctx: Ctx<'_>, level: String, text: String| -> JsResult<()> {
            h.console.borrow_mut().push(ConsoleEntry { level, text });
            Ok(())
        },
    )?;
    ctx.globals().set("__print", f)?;
    Ok(())
}

#[cfg(test)]
mod interrupt_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn cancel_flag_aborts_pending_future() {
        let cancel = Arc::new(AtomicBool::new(true)); // already cancelled
        let deadline = Instant::now() + Duration::from_secs(60);
        let fut = async { futures::future::pending::<Result<(), crate::error::AppError>>().await };
        let r = with_interrupt(cancel, deadline, fut).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn deadline_aborts_pending_future() {
        let cancel = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + Duration::from_millis(80);
        let fut = async { futures::future::pending::<Result<(), crate::error::AppError>>().await };
        let r = with_interrupt(cancel, deadline, fut).await;
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn completes_when_future_resolves_first() {
        let cancel = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + Duration::from_secs(60);
        let fut = async { Ok::<u8, crate::error::AppError>(7) };
        assert_eq!(with_interrupt(cancel, deadline, fut).await.unwrap(), 7);
    }
}

#[cfg(test)]
mod write_guard_tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn write_commands_are_detected() {
        for k in ["insert", "update", "delete", "findAndModify", "drop",
                  "dropDatabase", "create", "renameCollection", "createIndexes",
                  "dropIndexes", "createUser", "dropUser", "reIndex"] {
            assert!(is_write_command(&doc! { k: 1 }), "{k} should be a write");
        }
        // Match is case-insensitive on the first key.
        assert!(is_write_command(&doc! { "DropDatabase": 1 }));
    }

    #[test]
    fn read_commands_are_allowed() {
        for k in ["find", "aggregate", "count", "distinct", "dbStats",
                  "collStats", "listCollections", "ping", "buildInfo", "serverStatus"] {
            assert!(!is_write_command(&doc! { k: 1 }), "{k} should be allowed");
        }
        // An empty command document has no first key → not a write.
        assert!(!is_write_command(&Document::new()));
    }

    #[test]
    fn aggregate_out_or_merge_is_a_write() {
        use mongodb::bson::doc;
        assert!(pipeline_writes(&[doc!{"$match": {}}, doc!{"$out": "c"}]));
        assert!(pipeline_writes(&[doc!{"$merge": {"into": "c"}}]));
        assert!(!pipeline_writes(&[doc!{"$match": {}}, doc!{"$group": {"_id": 1}}]));
        assert!(!pipeline_writes(&[]));
    }
}

#[cfg(test)]
mod admin_command_tests {
    use super::*;
    use mongodb::bson::doc;

    #[test]
    fn read_command_passes_admin_gate() {
        // serverStatus is not in the write denylist → allowed even when read-only.
        assert!(!is_write_command(&doc! { "serverStatus": 1 }));
    }

    #[test]
    fn admin_write_command_is_gated() {
        // A write command sent via the admin channel must still be caught by the denylist.
        assert!(is_write_command(&doc! { "dropDatabase": 1 }));
    }
}
