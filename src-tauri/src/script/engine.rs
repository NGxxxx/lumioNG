//! QuickJS script engine — load prelude, eval user script, classify result.

use crate::script::outcome::{ConsoleEntry, Provenance, ResultDisplay, ScriptOutcome};
use mongodb::Client;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::runtime::Handle;

const PRELUDE: &str = include_str!("prelude.js");

/// Ensure a JS error message is never empty — callers display it directly in the UI.
pub(crate) fn error_text(raw: String) -> String {
    if raw.trim().is_empty() {
        "Script error (no message)".to_string()
    } else {
        raw
    }
}

/// Map the prelude's `__finalize` tagged object (as JSON) + console into a ScriptOutcome.
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
            let capped = all.len() > cap;
            let rows: Vec<String> = all.into_iter().take(cap).collect();
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
        _ => (ResultDisplay::None, None, false),
    };
    ScriptOutcome { console, result, provenance, capped, error: None }
}

/// Run `script` on a dedicated OS thread with the given MongoDB client and Tokio handle.
/// Returns a `ScriptOutcome` regardless of success or failure.
pub fn run(
    client: Client,
    handle: Handle,
    db: String,
    script: String,
    timeout_ms: u64,
    cap: usize,
    read_only: bool,
    cancel: Arc<AtomicBool>,
) -> ScriptOutcome {
    use crate::script::cursors::CursorStore;
    use crate::script::host;
    use crate::script::host::HostCtx;
    use rquickjs::{Context, Runtime};
    use std::cell::RefCell;
    use std::rc::Rc;

    let result = std::thread::spawn(move || {
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
            };

            host::bind(&ctx, host_ctx).map_err(|e| e.to_string())?;

            // Set __DBNAME and __USER_SRC globals
            ctx.globals()
                .set("__DBNAME", db.as_str())
                .map_err(|e| e.to_string())?;
            ctx.globals()
                .set("__USER_SRC", script.as_str())
                .map_err(|e| e.to_string())?;

            let eval_src =
                format!("{PRELUDE}\nJSON.stringify(__finalize((0,eval)(__USER_SRC)))");

            let eval_result: Result<String, String> = ctx
                .eval::<rquickjs::String, _>(eval_src)
                .and_then(|s| s.to_string())
                .map_err(|e| e.to_string());

            // Always close all cursors before returning
            cursors.borrow_mut().close_all();

            let console_entries = console.borrow().clone();

            match eval_result {
                Ok(finalized_json) => Ok(classify(&finalized_json, console_entries, cap)),
                Err(msg) => Ok(ScriptOutcome {
                    console: console_entries,
                    result: ResultDisplay::None,
                    provenance: None,
                    capped: false,
                    error: Some(error_text(msg)),
                }),
            }
        })
    })
    .join()
    .unwrap_or_else(|_| {
        Err("script thread panicked".to_string())
    });

    result.unwrap_or_else(|msg| ScriptOutcome {
        console: vec![],
        result: ResultDisplay::None,
        provenance: None,
        capped: false,
        error: Some(error_text(msg)),
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
    fn mapped_array_is_docs_without_provenance_and_caps() {
        let j = r#"{"t":"array","rows":[{"a":1},{"a":2},{"a":3}]}"#;
        let o = classify(j, vec![], 2);
        assert!(matches!(o.result, ResultDisplay::Docs { ref rows } if rows.len() == 2));
        assert_eq!(o.provenance, None);
        assert!(o.capped);
    }

    #[test]
    fn scalar_is_value() {
        let o = classify(r#"{"t":"value","json":"42"}"#, vec![], 10);
        assert!(matches!(o.result, ResultDisplay::Value { ref json } if json == "42"));
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
        );

        assert!(
            outcome.error.is_some(),
            "expected interrupt error, got outcome with no error"
        );
    }

    /// Verify that a script throwing an Error with an empty message still produces a non-empty
    /// error string in the outcome (guard via `error_text`).  No DB I/O occurs because the
    /// throw happens before any MongoDB call.
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
        );

        assert!(
            outcome.error.is_some(),
            "expected interrupt error from deadline, got outcome with no error"
        );
    }
}
