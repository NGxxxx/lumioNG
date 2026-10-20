//! Read-path bindings: `__find`, `__aggregate`, `__count`, `__distinct`, `__listCollections`, and cursor paging (`__cursorFetch`/`__cursorClose`).
use super::{pipeline_writes, run_blocking, HostCtx};
use mongodb::bson::Document;
use rquickjs::{Ctx, Function, Result as JsResult};
use std::time::Instant;

// ── __find ───────────────────────────────────────────────────────────────────

/// Reads a Bson field as `i64` whether the JS-side value arrived tagged `Int64` or `Int32`.
fn as_i64(v: Option<&mongodb::bson::Bson>) -> Option<i64> {
    use mongodb::bson::Bson;
    match v {
        Some(Bson::Int64(n)) => Some(*n),
        Some(Bson::Int32(n)) => Some(*n as i64),
        _ => None,
    }
}

/// Maps the JS-side find options doc onto a driver `FindOptions`; unit-testable in isolation.
fn apply_find_options(opts_doc: Option<&Document>, find_opts: &mut mongodb::options::FindOptions) {
    use mongodb::bson::Bson;
    let Some(o) = opts_doc else { return };
    if let Some(ms) = as_i64(o.get("maxTimeMS")) {
        find_opts.max_time = Some(std::time::Duration::from_millis(ms as u64));
    }
    if let Some(Bson::Document(sort)) = o.get("sort") {
        find_opts.sort = Some(sort.clone());
    }
    if let Some(l) = as_i64(o.get("limit")) {
        find_opts.limit = Some(l);
    }
    if let Some(s) = as_i64(o.get("skip")) {
        find_opts.skip = Some(s as u64);
    }
    if let Some(Bson::Document(proj)) = o.get("projection") {
        find_opts.projection = Some(proj.clone());
    }
}

pub(super) fn bind_find(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, coll, filterJson, optionsJson
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>,
              db: String,
              coll: String,
              filter_json: String,
              options_json: String|
              -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::json_bson::canonical_string_to_doc;
                use mongodb::options::FindOptions;

                let filter = canonical_string_to_doc(&filter_json)?;
                let opts_doc = canonical_string_to_doc(&options_json).ok();

                let collection = h.client.database(&db).collection::<Document>(&coll);

                let mut find_opts = FindOptions::default();
                apply_find_options(opts_doc.as_ref(), &mut find_opts);

                // Inject default maxTimeMS from deadline if not set by caller
                if find_opts.max_time.is_none() {
                    let remaining = h.deadline.saturating_duration_since(Instant::now());
                    if !remaining.is_zero() {
                        find_opts.max_time = Some(remaining);
                    }
                }

                let mut cursor = collection.find(filter).with_options(find_opts).await?;

                let batch_size = if h.cap == 0 { 101 } else { h.cap.min(101) };
                // Drain the first batch on the owned cursor (never across the RefCell borrow via `.await`), bytes-capped so huge documents can't fill one giant batch.
                let (rows, exhausted) = crate::script::cursors::CursorStore::drain(
                    &mut cursor, batch_size, crate::script::cursors::MAX_DRAIN_BYTES,
                )
                .await?;
                let handle_id = {
                    let mut store = h.cursors.borrow_mut();
                    let id = store.next_handle();
                    if !exhausted {
                        store.put(id, cursor);
                    }
                    id
                };

                let rows_json = rows
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(",");
                let bytes = rows_json.len();
                Ok::<String, crate::error::AppError>(format!(
                    r#"{{"handle":{handle_id},"rows":[{rows_json}],"exhausted":{exhausted},"bytes":{bytes}}}"#
                ))
            })
        },
    )?;
    ctx.globals().set("__find", f)?;
    Ok(())
}

// ── __aggregate ──────────────────────────────────────────────────────────────

pub(super) fn bind_aggregate(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, coll, pipelineJson (array), optionsJson
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>,
              db: String,
              coll: String,
              pipeline_json: String,
              options_json: String|
              -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::json_bson::canonical_string_to_doc_array;
                use crate::json_bson::canonical_string_to_doc;
                use mongodb::bson::Bson;
                use mongodb::options::AggregateOptions;

                let pipeline =
                    canonical_string_to_doc_array(&pipeline_json, "pipeline must be array", "pipeline stage must be a document")?;

                if h.read_only && pipeline_writes(&pipeline) {
                    return Err(crate::error::AppError::Query("Connection is read-only".into()));
                }

                let opts_doc = canonical_string_to_doc(&options_json).ok();

                let collection = h.client.database(&db).collection::<Document>(&coll);

                let mut agg_opts = AggregateOptions::default();
                if let Some(ref o) = opts_doc {
                    if let Some(Bson::Int64(ms)) = o.get("maxTimeMS") {
                        agg_opts.max_time = Some(std::time::Duration::from_millis(*ms as u64));
                    } else if let Some(Bson::Int32(ms)) = o.get("maxTimeMS") {
                        agg_opts.max_time = Some(std::time::Duration::from_millis(*ms as u64));
                    }
                }

                // Inject default maxTimeMS from deadline if not set by caller
                if agg_opts.max_time.is_none() {
                    let remaining = h.deadline.saturating_duration_since(Instant::now());
                    if !remaining.is_zero() {
                        agg_opts.max_time = Some(remaining);
                    }
                }

                // $out/$merge executes when the command is issued: audit it against its destination.
                let write_target = crate::audit::pipeline_write_target(&pipeline, &db, &coll);
                let started = collection.aggregate(pipeline).with_options(agg_opts).await.map_err(crate::error::AppError::from);
                if let Some((op, ns)) = write_target {
                    super::audit_write(&h, op, &ns, None, &started.as_ref().map(|_| None));
                }
                let mut cursor = started?;

                let batch_size = if h.cap == 0 { 101 } else { h.cap.min(101) };
                // Drain on the owned cursor first (no RefCell across await), bytes-capped so huge documents can't fill one giant batch.
                let (rows, exhausted) = crate::script::cursors::CursorStore::drain(
                    &mut cursor, batch_size, crate::script::cursors::MAX_DRAIN_BYTES,
                )
                .await?;
                let handle_id = {
                    let mut store = h.cursors.borrow_mut();
                    let id = store.next_handle();
                    if !exhausted {
                        store.put(id, cursor);
                    }
                    id
                };

                let rows_json = rows
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(",");
                let bytes = rows_json.len();
                Ok::<String, crate::error::AppError>(format!(
                    r#"{{"handle":{handle_id},"rows":[{rows_json}],"exhausted":{exhausted},"bytes":{bytes}}}"#
                ))
            })
        },
    )?;
    ctx.globals().set("__aggregate", f)?;
    Ok(())
}

// ── __count ───────────────────────────────────────────────────────────────────

pub(super) fn bind_count(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, coll, filterJson, mode ("estimated" | "exact")
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>,
              db: String,
              coll: String,
              filter_json: String,
              mode: String|
              -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                let c = h.client.database(&db).collection::<Document>(&coll);
                let n: i64 = match mode.as_str() {
                    "estimated" => c.estimated_document_count().await? as i64,
                    _ => {
                        let f = crate::json_bson::canonical_string_to_doc(&filter_json)?;
                        c.count_documents(f).await? as i64
                    }
                };
                Ok::<String, crate::error::AppError>(format!(r#"{{"$numberLong":"{n}"}}"#))
            })
        },
    )?;
    ctx.globals().set("__count", f)?;
    Ok(())
}

// ── __distinct ────────────────────────────────────────────────────────────────

pub(super) fn bind_distinct(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, coll, field, filterJson
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>,
              db: String,
              coll: String,
              field: String,
              filter_json: String|
              -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                use crate::bson_json::bson_to_canonical_string;

                let filter = crate::json_bson::canonical_string_to_doc(&filter_json)?;
                let c = h.client.database(&db).collection::<Document>(&coll);
                let values = c.distinct(&field, filter).await?;

                let parts: Result<Vec<String>, _> =
                    values.iter().map(bson_to_canonical_string).collect();
                Ok::<String, crate::error::AppError>(format!("[{}]", parts?.join(",")))
            })
        },
    )?;
    ctx.globals().set("__distinct", f)?;
    Ok(())
}

// ── __listCollections ─────────────────────────────────────────────────────────

pub(super) fn bind_list_collections(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String| -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                let names: Vec<String> = h.client.database(&db).list_collection_names().await?;

                // Serialize as a JSON array; serde handles quotes, backslashes, control chars.
                serde_json::to_string(&names)
                    .map_err(|e| crate::error::AppError::Query(e.to_string()))
            })
        },
    )?;
    ctx.globals().set("__listCollections", f)?;
    Ok(())
}

// ── __cursorFetch ─────────────────────────────────────────────────────────────

pub(super) fn bind_cursor_fetch(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: handle (u32), n (usize)
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, handle: u32, n: usize| -> JsResult<String> {
            let h = h.clone();
            run_blocking(h.clone(), &ctx, async move {
                // Take the cursor out so the RefCell isn't borrowed across `.await`.
                let taken = h.cursors.borrow_mut().take(handle);
                let mut cursor = match taken {
                    Some(c) => c,
                    None => return Err(crate::error::AppError::Query("unknown cursor".into())),
                };
                let (rows, exhausted) = crate::script::cursors::CursorStore::drain(
                    &mut cursor, n, crate::script::cursors::MAX_DRAIN_BYTES,
                )
                .await?;
                if !exhausted {
                    h.cursors.borrow_mut().put(handle, cursor);
                }
                let rows_json = rows.join(",");
                let bytes = rows_json.len();
                Ok::<String, crate::error::AppError>(format!(
                    r#"{{"rows":[{rows_json}],"exhausted":{exhausted},"bytes":{bytes}}}"#
                ))
            })
        },
    )?;
    ctx.globals().set("__cursorFetch", f)?;
    Ok(())
}

// ── __cursorClose ─────────────────────────────────────────────────────────────

pub(super) fn bind_cursor_close(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: handle (u32)
    let f = Function::new(
        ctx.clone(),
        move |_ctx: Ctx<'_>, handle: u32| -> JsResult<()> {
            h.cursors.borrow_mut().close(handle);
            Ok(())
        },
    )?;
    ctx.globals().set("__cursorClose", f)?;
    Ok(())
}

#[cfg(test)]
mod prelude_read_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("../prelude.js");

    // Read-focused stubs: count host-query opens + closes so we can prove a Cursor opens the
    // server-side query at most once even when hasNext()/next() ran before materialization.
    const STUBS: &str = r#"
globalThis.__openCount = 0;
globalThis.__closeCount = 0;
globalThis.__find = function(db, coll, q, o){
  var h = __openCount;            // unique handle per open
  __openCount += 1;
  return JSON.stringify({ handle: h, rows: [{ _id: { "$numberInt": "1" } }], exhausted: false });
};
globalThis.__aggregate = globalThis.__find;
globalThis.__cursorFetch = function(handle, n){ return JSON.stringify({ rows: [], exhausted: true }); };
globalThis.__cursorClose = function(handle){ __closeCount += 1; };
globalThis.__count = function(){ throw new Error("no count in read test"); };
globalThis.__distinct = function(){ throw new Error("no distinct in read test"); };
globalThis.__runCommand = function(){ return JSON.stringify({ ok: 1 }); };
globalThis.__listCollections = function(){ return "[]"; };
globalThis.__write = function(){ throw new Error("no write in read test"); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
"#;

    fn eval_int(user_js: &str, expr: &str) -> i32 {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            ctx.eval::<i32, _>(expr).unwrap()
        })
    }

    #[test]
    fn hasnext_then_finalize_opens_the_query_once() {
        // `c.hasNext()` opens a buffered handle; finalizing the same cursor must reuse it,
        // not re-run __find (which would leak the first handle until close_all).
        let opens = eval_int(r#"var c = db.c.find(); c.hasNext(); var r = __finalize(c);"#, "__openCount");
        assert_eq!(opens, 1, "cursor should open the host query exactly once");
    }

    #[test]
    fn hasnext_then_finalize_still_returns_the_buffered_row() {
        // Reusing the open handle must not drop the row already buffered by hasNext().
        let rows = eval_int(
            r#"var c = db.c.find(); c.hasNext(); globalThis.__r = __finalize(c);"#,
            "__r.rows.length",
        );
        assert_eq!(rows, 1, "the row buffered by hasNext() must survive finalization");
    }

    #[test]
    fn plain_finalize_without_hasnext_opens_once() {
        // Superseded: a pure find with no prior hasNext()/next() now bypasses materialization entirely and never opens the host query.
        let opens = eval_int(r#"var c = db.c.find(); var r = __finalize(c);"#, "__openCount");
        assert_eq!(opens, 0, "pure find with no hasNext() bypasses materialization, so it never opens the host query");
    }

    // First batch already meeting __CAP must skip __cursorFetch entirely.
    const CAP_STUBS: &str = r#"
globalThis.__CAP = 2;
globalThis.__fetchCount = 0;
globalThis.__find = function(db, coll, q, o){
  return JSON.stringify({ handle: 1, rows: [{a:1},{a:2}], exhausted: false });
};
globalThis.__aggregate = globalThis.__find;
globalThis.__cursorFetch = function(handle, n){
  __fetchCount += 1;
  return JSON.stringify({ rows: [{a:3}], exhausted: true });
};
globalThis.__cursorClose = function(){};
globalThis.__count = function(){ throw new Error("no count in read test"); };
globalThis.__distinct = function(){ throw new Error("no distinct in read test"); };
globalThis.__runCommand = function(){ return JSON.stringify({ ok: 1 }); };
globalThis.__listCollections = function(){ return "[]"; };
globalThis.__write = function(){ throw new Error("no write in read test"); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
"#;

    #[test]
    fn to_array_stops_draining_once_cap_already_met() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (rows, fetches) = ctx.with(|ctx| {
            ctx.eval::<(), _>(CAP_STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = db.c.find().toArray();"#).unwrap();
            let rows: i32 = ctx.eval("__r.length").unwrap();
            let fetches: i32 = ctx.eval("__fetchCount").unwrap();
            (rows, fetches)
        });
        assert_eq!(rows, 2, "should not pull past the cap");
        assert_eq!(fetches, 0, "cursorFetch must not run once the first batch already meets cap");
    }

    #[test]
    fn to_array_ignores_cap_when_zero() {
        // __CAP == 0 means unlimited: existing unbounded-drain behavior is preserved.
        let opens = eval_int(
            r#"var c = db.c.find(); var r = c.toArray();"#,
            "__openCount",
        );
        assert_eq!(opens, 1);
    }

    // A handful of huge documents must stop toArray() on byte size, not just row count.
    const BYTE_CAP_STUBS: &str = r#"
globalThis.__fetchCount = 0;
globalThis.__find = function(db, coll, q, o){
  return JSON.stringify({ handle: 1, rows: [{a:1}], exhausted: false, bytes: 999999999999 });
};
globalThis.__aggregate = globalThis.__find;
globalThis.__cursorFetch = function(handle, n){
  __fetchCount += 1;
  return JSON.stringify({ rows: [{a:2}], exhausted: true, bytes: 1 });
};
globalThis.__cursorClose = function(){};
globalThis.__count = function(){ throw new Error("no count in read test"); };
globalThis.__distinct = function(){ throw new Error("no distinct in read test"); };
globalThis.__runCommand = function(){ return JSON.stringify({ ok: 1 }); };
globalThis.__listCollections = function(){ return "[]"; };
globalThis.__write = function(){ throw new Error("no write in read test"); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
"#;

    #[test]
    fn to_array_stops_draining_once_byte_cap_exceeded() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (rows, fetches, capped) = ctx.with(|ctx| {
            ctx.eval::<(), _>(BYTE_CAP_STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__c = db.c.find(); globalThis.__r = __c.toArray();"#).unwrap();
            let rows: i32 = ctx.eval("__r.length").unwrap();
            let fetches: i32 = ctx.eval("__fetchCount").unwrap();
            let capped: bool = ctx.eval("__c._capped").unwrap();
            (rows, fetches, capped)
        });
        assert_eq!(rows, 1, "should stop after the first oversized batch");
        assert_eq!(fetches, 0, "cursorFetch must not run once the byte cap is already exceeded");
        assert!(capped, "cursor should report it stopped before natural exhaustion");
    }

    #[test]
    fn to_array_reports_uncapped_when_cursor_exhausts_naturally() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let capped: bool = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__c = db.c.find(); globalThis.__r = __c.toArray();"#).unwrap();
            ctx.eval("__c._capped").unwrap()
        });
        assert!(!capped, "a fully-drained cursor is not capped");
    }

    #[test]
    fn pure_find_finalizes_to_cursor_ref_without_opening_the_host_query() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (tag, opens) = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({a:1}));"#).unwrap();
            let tag: String = ctx.eval("__r.t").unwrap();
            let opens: i32 = ctx.eval("__openCount").unwrap();
            (tag, opens)
        });
        assert_eq!(tag, "cursorRef");
        assert_eq!(opens, 0, "a pure cursor must not open the host query at all");
    }

    #[test]
    fn cursor_ref_carries_db_coll_kind_and_options() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (kind, db, coll, limit): (String, String, String, i32) = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({a:1}).limit(5));"#).unwrap();
            (
                ctx.eval("__r.kind").unwrap(),
                ctx.eval("__r.db").unwrap(),
                ctx.eval("__r.coll").unwrap(),
                ctx.eval("__r.o.limit").unwrap(),
            )
        });
        assert_eq!(kind, "find");
        assert_eq!(db, "testdb");
        assert_eq!(coll, "c");
        assert_eq!(limit, 5);
    }

    #[test]
    fn pretty_is_chainable_and_does_not_alter_cursor_options() {
        // mongosh scripts commonly end a find with .pretty() — it must not error and must not
        // change the cursor's kind/options, since Grid/Tree already format the result.
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (kind, limit): (String, i32) = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({a:1}).limit(5).pretty());"#).unwrap();
            (ctx.eval("__r.kind").unwrap(), ctx.eval("__r.o.limit").unwrap())
        });
        assert_eq!(kind, "find");
        assert_eq!(limit, 5);
    }

    #[test]
    fn mapped_cursor_still_materializes_via_to_array() {
        // Cursor.map() returns a plain array, not `this`, so __finalize tags it "array" not "cursor" — either way, never "cursorRef".
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({}).map(function(d){return d;}));"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "array", ".map() must keep using the old materialize path (never cursorRef)");
    }

    #[test]
    fn mapped_cursor_still_carries_explain_hint_for_its_source_query() {
        // .map() loses the Cursor wrapper (see note above) but explainHint is derived from
        // __cursorsConstructed, independent of what __finalize's `v` argument ended up being.
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (kind, coll): (String, String) = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({a:1}).map(function(d){return d;}));"#).unwrap();
            (ctx.eval("__r.explainHint.kind").unwrap(), ctx.eval("__r.explainHint.coll").unwrap())
        });
        assert_eq!(kind, "find");
        assert_eq!(coll, "c");
    }

    #[test]
    fn foreach_cursor_still_carries_explain_hint_for_its_source_query() {
        // .forEach()'s completion value is `undefined` ("none" tag) — explainHint must still
        // survive since exactly one Cursor was constructed.
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let (t, kind): (String, String) = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({a:1}).forEach(function(d){}));"#).unwrap();
            (ctx.eval("__r.t").unwrap(), ctx.eval("__r.explainHint.kind").unwrap())
        });
        assert_eq!(t, "none");
        assert_eq!(kind, "find");
    }

    #[test]
    fn two_queries_in_one_script_yield_no_explain_hint() {
        // Ambiguous: more than one Cursor constructed means there's no single query to explain.
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let hint_is_null: bool = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"db.c.find({a:1}).toArray(); globalThis.__r = __finalize(db.c.find({b:2}));"#).unwrap();
            ctx.eval("__r.explainHint === null").unwrap()
        });
        assert!(hint_is_null, "two Cursors constructed in one run must yield explainHint: null");
    }

    #[test]
    fn projection_excluding_id_still_materializes_via_to_array() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.find({}, {_id: 0}));"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "cursor", "{{_id:0}} projection disables the recipe bypass (matches editable-grid gating)");
    }

    #[test]
    fn aggregate_pipeline_with_out_stage_is_excluded_from_the_bypass() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.aggregate([{"$out":"other"}]));"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "cursor", "$out/$merge pipelines must not use the recipe bypass (would re-run the write stage repeatedly)");
    }

    #[test]
    fn aggregate_pipeline_with_merge_stage_is_excluded_from_the_bypass() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.aggregate([{"$merge":"other"}]));"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "cursor");
    }

    #[test]
    fn plain_aggregate_pipeline_without_out_or_merge_uses_the_bypass() {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"globalThis.__r = __finalize(db.c.aggregate([{"$match":{}}]));"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "cursorRef");
    }

    #[test]
    fn impure_cursor_returned_directly_still_materializes_via_to_array() {
        // When the original (impure) cursor instance is returned directly, __finalize must fall through to the materialize/toArray path.
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        let tag: String = ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(r#"var c = db.c.find({}); c.map(function(d){return d;}); globalThis.__r = __finalize(c);"#).unwrap();
            ctx.eval("__r.t").unwrap()
        });
        assert_eq!(tag, "cursor", "impure cursor (_pure=false) returned directly to __finalize must materialize via toArray()");
    }
}

#[cfg(test)]
mod find_options_tests {
    use super::*;
    use mongodb::bson::doc;
    use mongodb::options::FindOptions;

    #[test]
    fn projection_is_mapped_onto_find_options() {
        let opts_doc = doc! { "projection": { "name": 1, "_id": 0 } };
        let mut find_opts = FindOptions::default();
        apply_find_options(Some(&opts_doc), &mut find_opts);
        assert_eq!(find_opts.projection, Some(doc! { "name": 1, "_id": 0 }));
    }

    #[test]
    fn sort_limit_skip_are_still_mapped_alongside_projection() {
        let opts_doc = doc! {
            "sort": { "a": -1 },
            "limit": 5i32,
            "skip": 2i32,
            "projection": { "a": 1 },
        };
        let mut find_opts = FindOptions::default();
        apply_find_options(Some(&opts_doc), &mut find_opts);
        assert_eq!(find_opts.sort, Some(doc! { "a": -1 }));
        assert_eq!(find_opts.limit, Some(5));
        assert_eq!(find_opts.skip, Some(2));
        assert_eq!(find_opts.projection, Some(doc! { "a": 1 }));
    }

    #[test]
    fn no_options_leaves_defaults() {
        let mut find_opts = FindOptions::default();
        apply_find_options(None, &mut find_opts);
        assert_eq!(find_opts.projection, None);
    }
}
