//! QuickJS script engine — load prelude, eval user script, classify result.

use crate::script::outcome::{ConsoleEntry, ExplainHint, Provenance, ResultDisplay, ScriptOutcome};
use mongodb::Client;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::runtime::Handle;

const PRELUDE: &str = include_str!("prelude.js");

/// Receives each console line the moment the script prints it.
pub type OutputSink = Arc<dyn Fn(&ConsoleEntry) + Send + Sync>;
/// Resolves `load("name")` to the saved snippet's source (`None` = no such name).
pub type SnippetLoader = Arc<dyn Fn(&str) -> Result<Option<String>, crate::error::AppError> + Send + Sync>;

/// Optional I/O hooks of one script run; the default (no streaming, no snippet library) suits tests.
#[derive(Clone, Default)]
pub struct ScriptIo {
    pub output: Option<OutputSink>,
    pub loader: Option<SnippetLoader>,
    pub load_policy: LoadPolicy,
    /// Overrides the per-run console budget (tests); `None` = [`OutputLimits::default`].
    pub limits: Option<crate::script::host::OutputLimits>,
}

/// Guards `load()`: on a PROD session, snippets containing destructive calls only run when the user confirmed this run.
/// The default is fail-closed (`prod: true`, nothing confirmed): a caller that forgets to set the policy
/// gets the strict one. `commands/script.rs` builds it explicitly from the session's environment.
#[derive(Clone, Copy)]
pub struct LoadPolicy {
    pub prod: bool,
    pub confirmed: bool,
}

impl Default for LoadPolicy {
    fn default() -> Self {
        Self { prod: true, confirmed: false }
    }
}

/// Ensure a JS error message is never empty — callers display it directly in the UI.
pub(crate) fn error_text(raw: String) -> String {
    if raw.trim().is_empty() {
        "Script error (no message)".to_string()
    } else {
        raw
    }
}

/// Format a caught QuickJS exception for display; plain `rquickjs::Error::Exception::to_string()` only yields a generic message, so the real name/message must be pulled via `Ctx::catch` before QuickJS clears it.
fn format_caught_error<'js>(ctx: &rquickjs::Ctx<'js>, caught: rquickjs::CaughtError<'js>) -> String {
    match caught {
        rquickjs::CaughtError::Exception(ex) => {
            let name = ex
                .get::<_, Option<String>>("name")
                .ok()
                .flatten()
                .unwrap_or_else(|| "Error".to_string());
            let message = ex.message().unwrap_or_default();
            let mut text = if message.is_empty() { name } else { format!("{name}: {message}") };
            if let Some(loc) = ex.stack().as_deref().and_then(input_location) {
                text.push_str(&format!(" ({loc})"));
            }
            text
        }
        // A script throwing a non-Error value hits this branch; coerce it like JS's `String(value)` instead of leaking rquickjs's raw Debug format to the user.
        rquickjs::CaughtError::Value(v) => {
            use rquickjs::FromJs;
            let text = rquickjs::Coerced::<String>::from_js(ctx, v)
                .map(|c| c.0)
                .unwrap_or_else(|_| "<unstringifiable value>".to_string());
            format!("Uncaught {text}")
        }
        rquickjs::CaughtError::Error(e) => e.to_string(),
    }
}

/// Pull the `<input>:line:col` frame out of a QuickJS stack trace — the remaining frames point into our prelude/eval wrapper and would only confuse the user.
fn input_location(stack: &str) -> Option<String> {
    let rest = stack.split("<input>:").nth(1)?;
    let end = rest.find(|c: char| !c.is_ascii_digit() && c != ':')?;
    let (line, col) = rest[..end].split_once(':')?;
    Some(format!("line {line}, column {col}"))
}

/// Shared `{kind, db, coll, q, o}` shape used by both the `cursorRef` result tag and the `explainHint` sibling field.
type CursorQueryFields = (String, String, String, String, Option<String>, Option<String>, i64, Option<i64>);

fn cursor_query_fields(v: &serde_json::Value) -> CursorQueryFields {
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("find").to_string();
    let db = v.get("db").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let coll = v.get("coll").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let query = v.get("q").map(|q| q.to_string()).unwrap_or_else(|| "{}".into());
    let o = v.get("o");
    let sort = o.and_then(|o| o.get("sort")).map(|s| s.to_string());
    let projection = o.and_then(|o| o.get("projection")).map(|p| p.to_string());
    let skip = o.and_then(|o| o.get("skip")).and_then(|s| s.as_i64()).unwrap_or(0);
    let limit = o.and_then(|o| o.get("limit")).and_then(|l| l.as_i64());
    (kind, db, coll, query, sort, projection, skip, limit)
}

fn parse_explain_hint(v: &serde_json::Value) -> Option<ExplainHint> {
    let hint = v.get("explainHint")?;
    if hint.is_null() {
        return None;
    }
    let (cursor_kind, db, coll, query, sort, projection, skip, limit) = cursor_query_fields(hint);
    Some(ExplainHint { cursor_kind, db, coll, query, sort, projection, skip, limit })
}

/// Map the prelude's `__finalize` tagged object (as JSON) + console into a ScriptOutcome; `cap == 0` means unlimited (no truncation), see `HostCtx::cap`.
pub fn classify(finalized_json: &str, console: Vec<ConsoleEntry>, cap: usize) -> ScriptOutcome {
    let v: serde_json::Value =
        serde_json::from_str(finalized_json).unwrap_or(serde_json::Value::Null);
    let t = v.get("t").and_then(|x| x.as_str()).unwrap_or("none");
    let (result, provenance, capped) = match t {
        "cursor" | "array" => {
            let all: Vec<String> = v
                .get("rows")
                .and_then(|r| r.as_array())
                .map(|a| a.iter().map(|x| x.to_string()).collect())
                .unwrap_or_default();
            // The JS side's `capped` flag is the source of truth; the row-count check here is just a fallback for values that never went through Cursor.toArray().
            let js_capped = v.get("capped").and_then(|c| c.as_bool()).unwrap_or(false);
            let capped = js_capped || (cap > 0 && all.len() > cap);
            let rows: Vec<String> = if cap == 0 { all } else { all.into_iter().take(cap).collect() };
            let prov = if t == "cursor"
                && v.get("pure").and_then(|p| p.as_bool()).unwrap_or(false)
            {
                v.get("src").map(|s| Provenance {
                    db: s.get("db").and_then(|x| x.as_str()).unwrap_or("").into(),
                    coll: s.get("coll").and_then(|x| x.as_str()).unwrap_or("").into(),
                })
            } else {
                None
            };
            (ResultDisplay::Docs { rows }, prov, capped)
        }
        "ack" => (
            ResultDisplay::Ack {
                json: v
                    .get("json")
                    .and_then(|x| x.as_str())
                    .unwrap_or("{}")
                    .into(),
            },
            None,
            false,
        ),
        "value" => (
            ResultDisplay::Value {
                json: v
                    .get("json")
                    .and_then(|x| x.as_str())
                    .unwrap_or("null")
                    .into(),
            },
            None,
            false,
        ),
        "cursorRef" => {
            let (kind, db, coll, query, sort, projection, base_skip, fixed_limit) =
                cursor_query_fields(&v);
            let provenance = Some(Provenance { db: db.clone(), coll: coll.clone() });
            (
                ResultDisplay::CursorQuery {
                    cursor_kind: kind,
                    db,
                    coll,
                    query,
                    sort,
                    projection,
                    base_skip,
                    fixed_limit,
                },
                provenance,
                false,
            )
        }
        _ => (ResultDisplay::None, None, false),
    };
    let explain_hint = parse_explain_hint(&v);
    ScriptOutcome { console, result, provenance, capped, error: None, explain_hint }
}

/// Run `script` synchronously with the given MongoDB client and Tokio handle, returning a `ScriptOutcome`
/// regardless of success or failure. Blocking and `!Send` (QuickJS `Runtime`/`Context`), so callers must
/// already be on a dedicated blocking thread -- `commands::script::run_script` uses `spawn_blocking`.
pub fn run(
    client: Client,
    handle: Handle,
    db: String,
    script: String,
    timeout_ms: u64,
    cap: usize,
    read_only: bool,
    cancel: Arc<AtomicBool>,
    audit: Option<crate::script::host::ScriptAudit>,
    io: ScriptIo,
) -> ScriptOutcome {
    use crate::script::cursors::CursorStore;
    use crate::script::host;
    use crate::script::host::HostCtx;
    use rquickjs::{Context, Runtime};
    use std::cell::RefCell;
    use std::rc::Rc;

    // `catch_unwind` turns a host/QuickJS panic into a script error instead of killing the thread.
    // The panic hook logs such panics but writes no crash report: the app survives them.
    let caught = crate::logging::CaughtPanicScope::enter();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let rt = Runtime::new().map_err(|e| e.to_string())?;

        // 256 MB memory limit
        rt.set_memory_limit(256 * 1024 * 1024);

        let start = Instant::now();
        let deadline = start + std::time::Duration::from_millis(timeout_ms);
        let cancel_i = cancel.clone();
        rt.set_interrupt_handler(Some(Box::new(move || {
            start.elapsed().as_millis() as u64 > timeout_ms
                || cancel_i.load(Ordering::Relaxed)
        })));

        let ctx = Context::full(&rt).map_err(|e| e.to_string())?;

        ctx.with(|ctx| {
            let console = Rc::new(RefCell::new(Vec::<ConsoleEntry>::new()));
            let cursors = Rc::new(RefCell::new(CursorStore::default()));

            let host_ctx = HostCtx {
                client,
                handle,
                console: console.clone(),
                cursors: cursors.clone(),
                cap,
                read_only,
                cancel: cancel.clone(),
                deadline,
                audit,
                sink: io.output,
                loader: io.loader,
                printer: Default::default(),
                budget: Rc::new(RefCell::new(host::OutputBudget::new(io.limits.unwrap_or_default()))),
                load_policy: io.load_policy,
            };
            let host_for_flush = host_ctx.clone();

            host::bind(&ctx, host_ctx).map_err(|e| e.to_string())?;

            // Set __DBNAME, __USER_SRC and __CAP globals
            ctx.globals()
                .set("__DBNAME", db.as_str())
                .map_err(|e| e.to_string())?;
            ctx.globals()
                .set("__USER_SRC", script.as_str())
                .map_err(|e| e.to_string())?;
            // __CAP bounds how many rows Cursor.toArray() drains from the host (0 = unlimited).
            ctx.globals()
                .set("__CAP", cap as u32)
                .map_err(|e| e.to_string())?;

            let eval_src =
                format!("{PRELUDE}\nJSON.stringify(__finalize((0,eval)(__USER_SRC)))");

            use rquickjs::CatchResultExt;
            let eval_result: Result<String, String> = match ctx
                .eval::<rquickjs::String, _>(eval_src)
                .catch(&ctx)
            {
                Ok(s) => s.to_string().map_err(|e| e.to_string()),
                Err(caught) => Err(format_caught_error(&ctx, caught)),
            };

            // Always close all cursors before returning
            cursors.borrow_mut().close_all();
            host_for_flush.flush_suppressed();

            let console_entries = console.borrow().clone();

            match eval_result {
                Ok(finalized_json) => Ok(classify(&finalized_json, console_entries, cap)),
                Err(msg) => Ok(ScriptOutcome {
                    console: console_entries,
                    result: ResultDisplay::None,
                    provenance: None,
                    capped: false,
                    error: Some(error_text(msg)),
                    explain_hint: None,
                }),
            }
        })
    }))
    .unwrap_or_else(|_| Err("script execution panicked".to_string()));
    drop(caught);

    result.unwrap_or_else(|msg| ScriptOutcome {
        console: vec![],
        result: ResultDisplay::None,
        provenance: None,
        capped: false,
        error: Some(error_text(msg)),
        explain_hint: None,
    })
}

#[cfg(test)]
mod error_text_tests {
    use super::*;

    #[test]
    fn non_empty_message_is_returned_unchanged() {
        assert_eq!(error_text("some error".to_string()), "some error");
    }

    #[test]
    fn empty_string_yields_fallback() {
        assert_eq!(error_text("".to_string()), "Script error (no message)");
    }

    #[test]
    fn whitespace_only_yields_fallback() {
        assert_eq!(error_text("   ".to_string()), "Script error (no message)");
    }
}

#[cfg(test)]
mod classify_tests {
    use super::*;

    #[test]
    fn pure_cursor_yields_docs_with_provenance() {
        let j =
            r#"{"t":"cursor","pure":true,"src":{"db":"d","coll":"c"},"rows":[{"a":1},{"a":2}]}"#;
        let o = classify(j, vec![], 10);
        assert!(matches!(o.result, ResultDisplay::Docs { ref rows } if rows.len() == 2));
        assert_eq!(o.provenance, Some(Provenance { db: "d".into(), coll: "c".into() }));
        assert!(!o.capped);
    }

    #[test]
    fn cursor_byte_capped_by_js_is_reported_even_under_row_cap() {
        // __BYTE_CAP can trip before row count reaches cap; JS-reported capped:true must survive even though the row-count check alone would say "not capped".
        let j = r#"{"t":"cursor","pure":true,"src":{"db":"d","coll":"c"},"rows":[{"a":1}],"capped":true}"#;
        let o = classify(j, vec![], 1000);
        assert!(matches!(o.result, ResultDisplay::Docs { ref rows } if rows.len() == 1));
        assert!(o.capped);
    }

    #[test]
    fn mapped_array_is_docs_without_provenance_and_caps() {
        let j = r#"{"t":"array","rows":[{"a":1},{"a":2},{"a":3}]}"#;
        let o = classify(j, vec![], 2);
        assert!(matches!(o.result, ResultDisplay::Docs { ref rows } if rows.len() == 2));
        assert_eq!(o.provenance, None);
        assert!(o.capped);
    }

    #[test]
    fn zero_cap_means_unlimited() {
        let j = r#"{"t":"array","rows":[{"a":1},{"a":2},{"a":3}]}"#;
        let o = classify(j, vec![], 0);
        assert!(matches!(o.result, ResultDisplay::Docs { ref rows } if rows.len() == 3));
        assert!(!o.capped);
    }

    #[test]
    fn cursor_ref_yields_cursor_query_with_recipe_fields() {
        let j = r#"{"t":"cursorRef","kind":"find","db":"d","coll":"c","q":{"a":1},"o":{"sort":{"a":1},"skip":10,"limit":5,"projection":{"b":0}}}"#;
        let o = classify(j, vec![], 1000);
        match o.result {
            ResultDisplay::CursorQuery {
                ref cursor_kind, ref db, ref coll, ref query, ref sort, ref projection, base_skip, fixed_limit,
            } => {
                assert_eq!(cursor_kind, "find");
                assert_eq!(db, "d");
                assert_eq!(coll, "c");
                assert_eq!(query, r#"{"a":1}"#);
                assert_eq!(sort.as_deref(), Some(r#"{"a":1}"#));
                assert_eq!(projection.as_deref(), Some(r#"{"b":0}"#));
                assert_eq!(base_skip, 10);
                assert_eq!(fixed_limit, Some(5));
            }
            ref other => panic!("expected CursorQuery, got {other:?}"),
        }
        assert_eq!(o.provenance, Some(Provenance { db: "d".into(), coll: "c".into() }));
        assert!(!o.capped);
    }

    #[test]
    fn cursor_ref_without_limit_or_skip_defaults_to_zero_and_none() {
        let j = r#"{"t":"cursorRef","kind":"agg","db":"d","coll":"c","q":[{"$match":{}}],"o":{}}"#;
        let o = classify(j, vec![], 1000);
        match o.result {
            ResultDisplay::CursorQuery { ref cursor_kind, ref query, base_skip, fixed_limit, .. } => {
                assert_eq!(cursor_kind, "agg");
                assert_eq!(query, r#"[{"$match":{}}]"#);
                assert_eq!(base_skip, 0);
                assert_eq!(fixed_limit, None);
            }
            ref other => panic!("expected CursorQuery, got {other:?}"),
        }
    }

    #[test]
    fn scalar_is_value() {
        let o = classify(r#"{"t":"value","json":"42"}"#, vec![], 10);
        assert!(matches!(o.result, ResultDisplay::Value { ref json } if json == "42"));
    }

    #[test]
    fn mapped_array_carries_explain_hint_from_the_single_source_cursor() {
        // find(...).map(fn): materializes to a plain array, but prelude.js still tags the
        // originating cursor's query onto explainHint since exactly one Cursor was constructed.
        let j = r#"{"t":"array","rows":[{"a":1}],"explainHint":{"kind":"find","db":"d","coll":"c","q":{"a":1},"o":{"sort":{"a":1}}}}"#;
        let o = classify(j, vec![], 1000);
        let hint = o.explain_hint.expect("explain_hint should be present");
        assert_eq!(hint.cursor_kind, "find");
        assert_eq!(hint.query, r#"{"a":1}"#);
        assert_eq!(hint.sort.as_deref(), Some(r#"{"a":1}"#));
    }

    #[test]
    fn absent_explain_hint_is_none() {
        let j = r#"{"t":"array","rows":[{"a":1}]}"#;
        let o = classify(j, vec![], 1000);
        assert_eq!(o.explain_hint, None);
    }

    #[test]
    fn null_explain_hint_is_none() {
        // Two (or zero) Cursors constructed in one script: prelude.js reports explainHint: null.
        let j = r#"{"t":"array","rows":[],"explainHint":null}"#;
        let o = classify(j, vec![], 1000);
        assert_eq!(o.explain_hint, None);
    }
}

#[cfg(test)]
mod run_tests {
    use super::*;

    /// Verify the interrupt handler fires when cancel is pre-set to true (no DB I/O needed).
    #[tokio::test]
    async fn cancel_flag_aborts_infinite_loop() {
        let client =
            Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();
        let cancel = Arc::new(AtomicBool::new(true)); // already cancelled

        let outcome = run(
            client,
            handle,
            "test".into(),
            "while(true){}".into(),
            60_000,
            1000,
            false,
            cancel,
            None,
            ScriptIo::default(),
        );

        assert!(
            outcome.error.is_some(),
            "expected interrupt error, got outcome with no error"
        );
    }

    /// A script throwing an Error with an empty message still produces a non-empty error string in the outcome.
    #[tokio::test]
    async fn empty_throw_message_yields_non_empty_outcome_error() {
        let client =
            Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client,
            handle,
            "test".into(),
            r#"throw new Error("")"#.into(),
            30_000,
            1000,
            false,
            Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert!(
            !err.trim().is_empty(),
            "error string must not be blank, got: {:?}",
            err
        );
    }

    /// Verify the deadline interrupt fires before timeout_ms elapses (200 ms deadline).
    #[tokio::test]
    async fn deadline_aborts_infinite_loop() {
        let client =
            Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client,
            handle,
            "test".into(),
            "while(true){}".into(),
            200,
            1000,
            false,
            Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        assert!(
            outcome.error.is_some(),
            "expected interrupt error from deadline, got outcome with no error"
        );
    }

    /// A malformed statement should surface QuickJS's actual SyntaxError message and the
    /// user-script location, not the generic "Exception generated by QuickJS" placeholder.
    #[tokio::test]
    async fn syntax_error_reports_name_message_and_location() {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client, handle, "test".into(), "db.c.find({".into(),
            30_000, 1000, false, Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert!(err.starts_with("SyntaxError:"), "got: {err:?}");
        assert!(err.contains("(line 1, column"), "got: {err:?}");
    }

    /// Referencing an undefined identifier should surface the ReferenceError's own message
    /// (not the generic placeholder), plus the offending line/column in the user's script.
    #[tokio::test]
    async fn reference_error_reports_name_message_and_location() {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client, handle, "test".into(), "undefinedFn()".into(),
            30_000, 1000, false, Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert_eq!(err, "ReferenceError: undefinedFn is not defined (line 1, column 1)");
    }

    /// An `async function`'s return value is an unresolved Promise (no microtask draining in
    /// this engine) — must surface a clear message, not an opaque `[object Promise]`.
    #[tokio::test]
    async fn async_function_result_reports_a_clear_promise_error() {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client, handle, "test".into(), "(async function(){ return 1; })()".into(),
            30_000, 1000, false, Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert!(err.contains("unresolved Promise"), "got: {err:?}");
        assert!(err.contains("async/await"), "got: {err:?}");
    }

    /// A script throwing a non-Error value (e.g. `throw null`) must read like a real JS console, not rquickjs's internal Debug format.
    #[tokio::test]
    async fn throwing_null_reports_a_readable_message() {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client, handle, "test".into(), "throw null".into(),
            30_000, 1000, false, Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert_eq!(err, "Uncaught null");
    }

    /// Same for a thrown plain string.
    #[tokio::test]
    async fn throwing_a_string_reports_a_readable_message() {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();

        let outcome = run(
            client, handle, "test".into(), r#"throw "boom""#.into(),
            30_000, 1000, false, Arc::new(AtomicBool::new(false)),
            None,
            ScriptIo::default(),
        );

        let err = outcome.error.expect("expected an error in outcome");
        assert_eq!(err, "Uncaught boom");
    }
}

#[cfg(test)]
mod console_load_tests {
    use super::*;
    use std::time::Duration;
    use std::collections::HashMap;
    use std::sync::Mutex;

    async fn run_with(script: &str, io: ScriptIo) -> ScriptOutcome {
        let client = Client::with_uri_str("mongodb://localhost:27017").await.unwrap();
        let handle = Handle::current();
        let script = script.to_string();
        // engine::run blocks on the runtime handle, so it needs its own blocking thread.
        tokio::task::spawn_blocking(move || {
            run(client, handle, "test".into(), script, 30_000, 1000, false, Arc::new(AtomicBool::new(false)), None, io)
        })
        .await
        .unwrap()
    }

    fn loader(snippets: &[(&str, &str)]) -> SnippetLoader {
        let map: HashMap<String, String> = snippets.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        Arc::new(move |name| Ok(map.get(name).cloned()))
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn print_is_streamed_before_script_ends() {
        let seen: Arc<Mutex<Vec<(String, Instant)>>> = Arc::default();
        let sink_seen = seen.clone();
        let io = ScriptIo {
            output: Some(Arc::new(move |e: &ConsoleEntry| sink_seen.lock().unwrap().push((e.text.clone(), Instant::now())))),
            ..Default::default()
        };
        let outcome = run_with(
            r#"print("first"); var t = Date.now(); while (Date.now() - t < 300) {} print("second");"#,
            io,
        )
        .await;
        let done = Instant::now();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>(), ["first", "second"]);
        assert!(done.duration_since(seen[0].1) >= Duration::from_millis(250), "first line must arrive while the script still runs");
        // The final outcome keeps the same lines.
        assert_eq!(outcome.console.len(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn output_over_1000_lines_per_second_is_suppressed_with_a_marker() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink_seen = seen.clone();
        let io = ScriptIo {
            output: Some(Arc::new(move |e: &ConsoleEntry| sink_seen.lock().unwrap().push(e.text.clone()))),
            ..Default::default()
        };
        let outcome = run_with(r#"for (var i = 0; i < 1500; i++) print("l" + i);"#, io).await;
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1001, "1000 lines plus one marker");
        assert_eq!(seen.last().unwrap(), "…500 lines suppressed");
        assert_eq!(&outcome.console.iter().map(|c| c.text.clone()).collect::<Vec<_>>(), &*seen);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_runs_saved_snippet() {
        let io = ScriptIo { output: None, loader: Some(loader(&[("helper", "var base = 40; base + 2")])), ..Default::default() };
        let outcome = run_with(r#"var r = load("helper"); r + base"#, io).await;
        assert_eq!(outcome.error, None);
        assert!(matches!(outcome.result, ResultDisplay::Value { ref json } if json == "82"), "got {:?}", outcome.result);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_of_a_missing_name_names_it() {
        let io = ScriptIo { output: None, loader: Some(loader(&[("Helper", "1")])), ..Default::default() };
        let outcome = run_with(r#"load("helper")"#, io).await;
        let err = outcome.error.expect("error");
        assert!(err.contains(r#"load("helper")"#) && err.contains("not found"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_recursion_is_capped() {
        let io = ScriptIo { output: None, loader: Some(loader(&[("a", r#"load("b")"#), ("b", r#"load("a")"#)])), ..Default::default() };
        let outcome = run_with(r#"load("a")"#, io).await;
        let err = outcome.error.expect("error");
        assert!(err.contains("depth 8"), "got {err}");
        assert!(err.contains("a → b → a → b"), "chain must be named: {err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unknown_collection_method_has_friendly_error() {
        let outcome = run_with("db.coll.foo()", ScriptIo::default()).await;
        let err = outcome.error.expect("error");
        assert!(
            err.contains("db.coll.foo is not supported in LumioNG (see Help → mongosh compatibility)"),
            "got {err}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn unknown_cursor_method_and_db_method_have_friendly_errors() {
        let err = run_with("db.coll.find().batchSize(5)", ScriptIo::default()).await.error.expect("error");
        assert!(err.contains("db.coll.find().batchSize is not supported in LumioNG"), "got {err}");
        let err = run_with("rs.nope()", ScriptIo::default()).await.error.expect("error");
        assert!(err.contains("rs.nope is not supported in LumioNG"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn supported_and_internal_properties_still_work() {
        let outcome = run_with("db.coll.getName() + '|' + (typeof db.coll.find) + '|' + JSON.stringify(db.coll.then)", ScriptIo::default()).await;
        assert_eq!(outcome.error, None);
        assert!(matches!(outcome.result, ResultDisplay::Value { ref json } if json == r#""coll|function|undefined""#), "got {:?}", outcome.result);
    }

    fn prod_io(prod: bool, confirmed: bool) -> ScriptIo {
        // Defines (never calls) a destructive function, so no database is needed.
        ScriptIo {
            loader: Some(loader(&[("wipe", "var f = function () { db.c.deleteMany({}); }; 7"), ("safe", "8")])),
            load_policy: LoadPolicy { prod, confirmed },
            ..Default::default()
        }
    }

    #[test]
    fn the_default_load_policy_is_fail_closed() {
        let p = LoadPolicy::default();
        assert!(p.prod && !p.confirmed);
        let p = ScriptIo::default().load_policy;
        assert!(p.prod && !p.confirmed);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn prod_unconfirmed_load_of_a_destructive_snippet_is_refused() {
        let err = run_with(r#"load("wipe")"#, prod_io(true, false)).await.error.expect("refused");
        assert!(err.contains(r#"load("wipe")"#) && err.contains("deleteMany") && err.contains("confirm"), "got {err}");
        // Snippets without destructive calls still load.
        let ok = run_with(r#"load("safe")"#, prod_io(true, false)).await;
        assert_eq!(ok.error, None);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn prod_confirmed_and_non_prod_loads_are_allowed() {
        for io in [prod_io(true, true), prod_io(false, false)] {
            let o = run_with(r#"load("wipe")"#, io).await;
            assert_eq!(o.error, None);
            assert!(matches!(o.result, ResultDisplay::Value { ref json } if json == "7"), "got {:?}", o.result);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn prod_refusal_also_covers_nested_loads() {
        let io = ScriptIo {
            loader: Some(loader(&[("outer", r#"load("wipe")"#), ("wipe", "var f = function () { db.c.drop(); }")])),
            load_policy: LoadPolicy { prod: true, confirmed: false },
            ..Default::default()
        };
        let err = run_with(r#"load("outer")"#, io).await.error.expect("refused");
        assert!(err.contains("drop"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn console_output_is_capped_by_lines_with_one_marker() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let sink_seen = seen.clone();
        let io = ScriptIo {
            output: Some(Arc::new(move |e: &ConsoleEntry| sink_seen.lock().unwrap().push(e.text.clone()))),
            limits: Some(crate::script::host::OutputLimits { max_lines: 50, max_bytes: 1 << 20 }),
            ..Default::default()
        };
        let outcome = run_with(r#"for (var i = 0; i < 80; i++) print("l" + i);"#, io).await;
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 51, "50 lines plus one marker");
        assert_eq!(seen.last().unwrap(), "…output truncated after 50 lines");
        assert_eq!(&outcome.console.iter().map(|c| c.text.clone()).collect::<Vec<_>>(), &*seen);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn console_output_is_capped_by_bytes() {
        let io = ScriptIo {
            limits: Some(crate::script::host::OutputLimits { max_lines: 1000, max_bytes: 100 }),
            ..Default::default()
        };
        let outcome = run_with(r#"for (var i = 0; i < 20; i++) print("0123456789012345678901234567890123456789");"#, io).await;
        assert_eq!(outcome.console.len(), 3, "two 40-byte lines fit, then the marker: {:?}", outcome.console);
        assert_eq!(outcome.console[2].text, "…output truncated after 2 lines");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn nested_missing_load_shows_the_chain() {
        let io = ScriptIo { loader: Some(loader(&[("a", r#"load("b")"#), ("b", r#"load("missing")"#)])), ..Default::default() };
        let err = run_with(r#"load("a")"#, io).await.error.expect("error");
        assert!(err.contains("a → b → missing"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn eval_error_inside_a_snippet_names_the_snippet() {
        let io = ScriptIo { loader: Some(loader(&[("outer", r#"load("bad")"#), ("bad", "throw new Error('boom')")])), ..Default::default() };
        let err = run_with(r#"load("outer")"#, io).await.error.expect("error");
        assert!(err.contains(r#"saved query "bad""#) && err.contains("boom"), "got {err}");
        assert!(err.contains(r#"saved query "outer""#), "outer frame named too: {err}");
        let io = ScriptIo { loader: Some(loader(&[("syn", "var = ;")])), ..Default::default() };
        let err = run_with(r#"load("syn")"#, io).await.error.expect("error");
        assert!(err.contains(r#"saved query "syn""#) && err.contains("SyntaxError"), "got {err}");
    }
}
