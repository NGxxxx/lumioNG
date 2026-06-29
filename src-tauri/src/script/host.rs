//! QuickJS host context and global function bindings for the script engine.
//!
//! `HostCtx` carries the MongoDB client, Tokio handle, console sink, cursor registry, and
//! row-cap for a single script run. `bind(ctx, host)` registers all `__xxx` globals that
//! the JS prelude (Task 6) calls.
use crate::script::cursors::CursorStore;
use crate::script::outcome::ConsoleEntry;
use mongodb::{bson::{Bson, Document}, Client};
use rquickjs::{Ctx, Exception, Function, Result as JsResult};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::runtime::Handle;

// ── with_interrupt ────────────────────────────────────────────────────────────

/// Race a driver future against the cancel flag and a deadline. Polls every 50 ms while
/// the future is blocked (the future itself isn't pollable for cancellation), so a hung
/// query is interrupted by Cancel or timeout.
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

// ── HostCtx ──────────────────────────────────────────────────────────────────

/// Shared context passed into every host function closure. `Rc`-based because
/// QuickJS is single-threaded; all host fn calls happen on the same worker thread.
#[derive(Clone)]
pub struct HostCtx {
    pub client: Client,
    pub handle: Handle,
    pub console: Rc<RefCell<Vec<ConsoleEntry>>>,
    pub cursors: Rc<RefCell<CursorStore>>,
    /// Maximum number of rows returned per cursor open (cap for result display).
    pub cap: usize,
    /// When true, write/DDL host paths reject the operation.
    pub read_only: bool,
    /// Cancel flag shared with the interrupt handler; set to true to abort in-flight ops.
    pub cancel: Arc<AtomicBool>,
    /// Absolute deadline for all DB operations in this script run.
    pub deadline: Instant,
}

// ── Error helper ─────────────────────────────────────────────────────────────

/// Convert any displayable error into a thrown JS exception.
fn to_js_err<'js>(ctx: &Ctx<'js>, e: impl ToString) -> rquickjs::Error {
    Exception::throw_message(ctx, &e.to_string())
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
    "createcollection", "createview", "createindex",
];

/// True if the command document's first key is a known write/DDL command (case-insensitive).
pub(crate) fn is_write_command(cmd: &Document) -> bool {
    cmd.keys()
        .next()
        .map(|k| WRITE_COMMANDS.contains(&k.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// True if an aggregation pipeline writes to a collection: any `$out` or `$merge` stage.
/// (`$out` must be last and `$merge` last per server rules, but we scan all stages defensively.)
pub(crate) fn pipeline_writes(pipeline: &[Document]) -> bool {
    pipeline.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge"))
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/// Reject a write when the session is read-only.
pub(crate) fn ensure_writable(read_only: bool) -> Result<(), crate::error::AppError> {
    if read_only {
        Err(crate::error::AppError::Query("Connection is read-only".into()))
    } else {
        Ok(())
    }
}

/// One parsed write op (BSON already materialized).
pub(crate) enum WriteOp {
    InsertOne(Document),
    InsertMany(Vec<Document>),
    UpdateOne { filter: Document, update: Document, upsert: bool, array_filters: Option<Vec<Document>> },
    UpdateMany { filter: Document, update: Document, upsert: bool, array_filters: Option<Vec<Document>> },
    ReplaceOne { filter: Document, replacement: Document, upsert: bool },
    DeleteOne(Document),
    DeleteMany(Document),
}

/// Accumulated write counts + ids across an op array.
#[derive(Default)]
pub(crate) struct WriteAccum {
    pub inserted_count: u64,
    pub matched_count: u64,
    pub modified_count: u64,
    pub upserted_count: u64,
    pub deleted_count: u64,
    pub inserted_ids: Vec<String>, // each is Canonical ExtJSON
    pub upserted_ids: Vec<String>,
}

impl WriteAccum {
    pub fn build_ack(&self) -> String {
        let ids = self.inserted_ids.join(",");
        let ups = self.upserted_ids.join(",");
        format!(
            r#"{{"acknowledged":true,"insertedCount":{{"$numberLong":"{}"}},"matchedCount":{{"$numberLong":"{}"}},"modifiedCount":{{"$numberLong":"{}"}},"upsertedCount":{{"$numberLong":"{}"}},"deletedCount":{{"$numberLong":"{}"}},"insertedIds":[{ids}],"upsertedIds":[{ups}]}}"#,
            self.inserted_count, self.matched_count, self.modified_count,
            self.upserted_count, self.deleted_count
        )
    }
}

fn opt_bool(d: &Document, k: &str) -> bool {
    matches!(d.get(k), Some(Bson::Boolean(true)))
}

fn req_doc(d: &Document, k: &str) -> Result<Document, crate::error::AppError> {
    d.get_document(k)
        .map(|x| x.clone())
        .map_err(|_| crate::error::AppError::Query(format!("write op missing '{k}' document")))
}

fn opt_array_filters(d: &Document) -> Option<Vec<Document>> {
    d.get_array("arrayFilters").ok().map(|arr| {
        arr.iter().filter_map(|b| b.as_document().cloned()).collect()
    })
}

/// Parse the `__write` payload JSON into (ordered, ops).
pub(crate) fn parse_write_ops(ops_json: &str) -> Result<(bool, Vec<WriteOp>), crate::error::AppError> {
    let root = crate::json_bson::canonical_string_to_doc(ops_json)?;
    let ordered = match root.get("ordered") {
        Some(Bson::Boolean(b)) => *b,
        _ => true,
    };
    let arr = root
        .get_array("ops")
        .map_err(|_| crate::error::AppError::Query("write payload missing 'ops' array".into()))?;
    let mut ops = Vec::with_capacity(arr.len());
    for b in arr {
        let d = b
            .as_document()
            .ok_or_else(|| crate::error::AppError::Query("each write op must be a document".into()))?;
        let kind = d
            .get_str("op")
            .map_err(|_| crate::error::AppError::Query("write op missing 'op'".into()))?;
        let op = match kind {
            "insertOne" => WriteOp::InsertOne(req_doc(d, "document")?),
            "insertMany" => {
                let arr = d.get_array("documents").map_err(|_| {
                    crate::error::AppError::Query("insertMany 'documents' must be an array".into())
                })?;
                let docs: Result<Vec<Document>, crate::error::AppError> = arr
                    .iter()
                    .map(|b| {
                        b.as_document()
                            .cloned()
                            .ok_or_else(|| crate::error::AppError::Query(
                                "each insertMany document must be a document".into(),
                            ))
                    })
                    .collect();
                WriteOp::InsertMany(docs?)
            }
            "updateOne" => WriteOp::UpdateOne {
                filter: req_doc(d, "filter")?,
                update: req_doc(d, "update")?,
                upsert: opt_bool(d, "upsert"),
                array_filters: opt_array_filters(d),
            },
            "updateMany" => WriteOp::UpdateMany {
                filter: req_doc(d, "filter")?,
                update: req_doc(d, "update")?,
                upsert: opt_bool(d, "upsert"),
                array_filters: opt_array_filters(d),
            },
            "replaceOne" => WriteOp::ReplaceOne {
                filter: req_doc(d, "filter")?,
                replacement: req_doc(d, "replacement")?,
                upsert: opt_bool(d, "upsert"),
            },
            "deleteOne" => WriteOp::DeleteOne(req_doc(d, "filter")?),
            "deleteMany" => WriteOp::DeleteMany(req_doc(d, "filter")?),
            other => {
                return Err(crate::error::AppError::Query(format!("unknown write op '{other}'")))
            }
        };
        ops.push(op);
    }
    Ok((ordered, ops))
}

// ── bind ─────────────────────────────────────────────────────────────────────

/// Register all `__xxx` globals into `ctx`.
pub fn bind(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    bind_find(ctx, host.clone())?;
    bind_aggregate(ctx, host.clone())?;
    bind_count(ctx, host.clone())?;
    bind_distinct(ctx, host.clone())?;
    bind_write(ctx, host.clone())?;
    bind_run_command(ctx, host.clone())?;
    bind_list_collections(ctx, host.clone())?;
    bind_cursor_fetch(ctx, host.clone())?;
    bind_cursor_close(ctx, host.clone())?;
    bind_print(ctx, host)?;
    Ok(())
}

// ── __write ──────────────────────────────────────────────────────────────────

fn bind_write(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String, coll: String, ops_json: String| -> JsResult<String> {
            let h = h.clone();
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                use crate::bson_json::bson_to_canonical_string;
                use mongodb::options::{ReplaceOptions, UpdateOptions};

                ensure_writable(h.read_only)?;
                let (ordered, ops) = parse_write_ops(&ops_json)?;
                let c = h.client.database(&db).collection::<Document>(&coll);

                let mut acc = WriteAccum::default();
                let mut first_err: Option<crate::error::AppError> = None;

                for op in ops {
                    let step: Result<(), crate::error::AppError> = async {
                        match op {
                            WriteOp::InsertOne(doc) => {
                                let r = c
                                    .insert_one(doc)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.inserted_count += 1;
                                acc.inserted_ids.push(bson_to_canonical_string(&r.inserted_id)?);
                            }
                            WriteOp::InsertMany(docs) => {
                                let r = c
                                    .insert_many(docs)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.inserted_count += r.inserted_ids.len() as u64;
                                let mut entries: Vec<_> = r.inserted_ids.iter().collect();
                                entries.sort_by_key(|(k, _)| **k);
                                for (_, b) in entries {
                                    acc.inserted_ids.push(bson_to_canonical_string(b)?);
                                }
                            }
                            WriteOp::UpdateOne { filter, update, upsert, array_filters } => {
                                let mut o = UpdateOptions::builder().upsert(upsert).build();
                                o.array_filters = array_filters;
                                let r = c
                                    .update_one(filter, update)
                                    .with_options(o)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::UpdateMany { filter, update, upsert, array_filters } => {
                                let mut o = UpdateOptions::builder().upsert(upsert).build();
                                o.array_filters = array_filters;
                                let r = c
                                    .update_many(filter, update)
                                    .with_options(o)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::ReplaceOne { filter, replacement, upsert } => {
                                let o = ReplaceOptions::builder().upsert(upsert).build();
                                let r = c
                                    .replace_one(filter, replacement)
                                    .with_options(o)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.matched_count += r.matched_count;
                                acc.modified_count += r.modified_count;
                                if let Some(id) = r.upserted_id {
                                    acc.upserted_count += 1;
                                    acc.upserted_ids.push(bson_to_canonical_string(&id)?);
                                }
                            }
                            WriteOp::DeleteOne(filter) => {
                                let r = c
                                    .delete_one(filter)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.deleted_count += r.deleted_count;
                            }
                            WriteOp::DeleteMany(filter) => {
                                let r = c
                                    .delete_many(filter)
                                    .await
                                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                                acc.deleted_count += r.deleted_count;
                            }
                        }
                        Ok(())
                    }
                    .await;

                    if let Err(e) = step {
                        if ordered {
                            return Err(e);
                        }
                        // NOTE: on a mid-op driver failure (e.g. duplicate key), counts/ids for the
                        // partially-applied op are not reflected in the ack — the op's result is lost
                        // to the error path. Acceptable for v1; the surfaced error signals the failure.
                        first_err.get_or_insert(e);
                    }
                }

                if let Some(e) = first_err {
                    return Err(e);
                }
                Ok::<String, crate::error::AppError>(acc.build_ack())
            }));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__write", f)?;
    Ok(())
}

// ── __find ───────────────────────────────────────────────────────────────────

fn bind_find(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
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
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    use crate::json_bson::canonical_string_to_doc;
                    use mongodb::bson::Bson;
                    use mongodb::options::FindOptions;

                    let filter = canonical_string_to_doc(&filter_json)?;
                    let opts_doc = canonical_string_to_doc(&options_json).ok();

                    let collection = h.client.database(&db).collection::<Document>(&coll);

                    let mut find_opts = FindOptions::default();
                    if let Some(ref o) = opts_doc {
                        // maxTimeMS
                        if let Some(Bson::Int64(ms)) = o.get("maxTimeMS") {
                            find_opts.max_time = Some(std::time::Duration::from_millis(*ms as u64));
                        } else if let Some(Bson::Int32(ms)) = o.get("maxTimeMS") {
                            find_opts.max_time = Some(std::time::Duration::from_millis(*ms as u64));
                        }
                        // sort
                        if let Some(Bson::Document(sort)) = o.get("sort") {
                            find_opts.sort = Some(sort.clone());
                        }
                        // limit
                        if let Some(Bson::Int64(l)) = o.get("limit") {
                            find_opts.limit = Some(*l);
                        } else if let Some(Bson::Int32(l)) = o.get("limit") {
                            find_opts.limit = Some(*l as i64);
                        }
                        // skip
                        if let Some(Bson::Int64(s)) = o.get("skip") {
                            find_opts.skip = Some(*s as u64);
                        } else if let Some(Bson::Int32(s)) = o.get("skip") {
                            find_opts.skip = Some(*s as u64);
                        }
                    }

                    // Inject default maxTimeMS from deadline if not set by caller
                    if find_opts.max_time.is_none() {
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if !remaining.is_zero() {
                            find_opts.max_time = Some(remaining);
                        }
                    }

                    let cursor = collection
                        .find(filter)
                        .with_options(find_opts)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    let batch_size = h.cap.min(101);
                    let mut store = h.cursors.borrow_mut();
                    let handle_id = store.insert(cursor);
                    let (rows, exhausted) = store.fetch(handle_id, batch_size).await?;

                    let rows_json = rows
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(",");
                    Ok::<String, crate::error::AppError>(format!(
                        r#"{{"handle":{handle_id},"rows":[{rows_json}],"exhausted":{exhausted}}}"#
                    ))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__find", f)?;
    Ok(())
}

// ── __aggregate ──────────────────────────────────────────────────────────────

fn bind_aggregate(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
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
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
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
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if !remaining.is_zero() {
                            agg_opts.max_time = Some(remaining);
                        }
                    }

                    let cursor = collection
                        .aggregate(pipeline)
                        .with_options(agg_opts)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    let batch_size = h.cap.min(101);
                    let mut store = h.cursors.borrow_mut();
                    let handle_id = store.insert(cursor);
                    let (rows, exhausted) = store.fetch(handle_id, batch_size).await?;

                    let rows_json = rows
                        .iter()
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(",");
                    Ok::<String, crate::error::AppError>(format!(
                        r#"{{"handle":{handle_id},"rows":[{rows_json}],"exhausted":{exhausted}}}"#
                    ))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__aggregate", f)?;
    Ok(())
}

// ── __count ───────────────────────────────────────────────────────────────────

fn bind_count(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
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
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    let c = h.client.database(&db).collection::<Document>(&coll);
                    let n: i64 = match mode.as_str() {
                        "estimated" => c
                            .estimated_document_count()
                            .await
                            .map_err(|e| crate::error::AppError::Query(e.to_string()))? as i64,
                        _ => {
                            let f = crate::json_bson::canonical_string_to_doc(&filter_json)?;
                            c.count_documents(f)
                                .await
                                .map_err(|e| crate::error::AppError::Query(e.to_string()))? as i64
                        }
                    };
                    Ok::<String, crate::error::AppError>(format!(r#"{{"$numberLong":"{n}"}}"#))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__count", f)?;
    Ok(())
}

// ── __distinct ────────────────────────────────────────────────────────────────

fn bind_distinct(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
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
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    use crate::bson_json::bson_to_canonical_string;

                    let filter = crate::json_bson::canonical_string_to_doc(&filter_json)?;
                    let c = h.client.database(&db).collection::<Document>(&coll);
                    let values = c
                        .distinct(&field, filter)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    let parts: Result<Vec<String>, _> =
                        values.iter().map(bson_to_canonical_string).collect();
                    Ok::<String, crate::error::AppError>(format!("[{}]", parts?.join(",")))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__distinct", f)?;
    Ok(())
}

// ── __runCommand ──────────────────────────────────────────────────────────────

fn bind_run_command(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db, cmdJson
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String, cmd_json: String| -> JsResult<String> {
            let h = h.clone();
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    use crate::bson_json::doc_to_canonical_string;

                    let cmd = crate::json_bson::canonical_string_to_doc(&cmd_json)?;
                    if h.read_only && is_write_command(&cmd) {
                        return Err(crate::error::AppError::Query(
                            "Connection is read-only".into(),
                        ));
                    }
                    let reply = h
                        .client
                        .database(&db)
                        .run_command(cmd)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                    doc_to_canonical_string(reply)
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__runCommand", f)?;
    Ok(())
}

// ── __listCollections ─────────────────────────────────────────────────────────

fn bind_list_collections(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: db
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, db: String| -> JsResult<String> {
            let h = h.clone();
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    let names: Vec<String> = h
                        .client
                        .database(&db)
                        .list_collection_names()
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    // Return as JSON array of quoted strings.
                    let quoted: Vec<String> =
                        names.iter().map(|n| format!(r#""{}""#, n.replace('"', r#"\""#))).collect();
                    Ok::<String, crate::error::AppError>(format!("[{}]", quoted.join(",")))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__listCollections", f)?;
    Ok(())
}

// ── __cursorFetch ─────────────────────────────────────────────────────────────

fn bind_cursor_fetch(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: handle (u32), n (usize)
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, handle: u32, n: usize| -> JsResult<String> {
            let h = h.clone();
            let cancel = h.cancel.clone();
            let deadline = h.deadline;
            let result = h.handle.block_on(crate::script::host::with_interrupt(
                cancel, deadline,
                async move {
                    let mut store = h.cursors.borrow_mut();
                    let (rows, exhausted) = store.fetch(handle, n).await?;
                    let rows_json = rows.join(",");
                    Ok::<String, crate::error::AppError>(format!(
                        r#"{{"rows":[{rows_json}],"exhausted":{exhausted}}}"#
                    ))
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__cursorFetch", f)?;
    Ok(())
}

// ── __cursorClose ─────────────────────────────────────────────────────────────

fn bind_cursor_close(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
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
mod prelude_write_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("prelude.js");

    const STUBS: &str = r#"
globalThis.__lastWriteOps = null;
globalThis.__write = function(db, coll, ops){ __lastWriteOps = ops; return JSON.stringify({acknowledged:true,insertedCount:{$numberLong:"1"},matchedCount:{$numberLong:"0"},modifiedCount:{$numberLong:"0"},upsertedCount:{$numberLong:"0"},deletedCount:{$numberLong:"0"},insertedIds:[],upsertedIds:[]}); };
globalThis.__lastCmd = null;
globalThis.__runCommand = function(db, cmd){ __lastCmd = cmd; return JSON.stringify({ok:1, value:null}); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
globalThis.__find = function(){ throw new Error("no read in write test"); };
globalThis.__aggregate = function(){ throw new Error("no read in write test"); };
globalThis.__count = function(){ throw new Error("no read in write test"); };
globalThis.__distinct = function(){ throw new Error("no read in write test"); };
globalThis.__listCollections = function(){ throw new Error("no read in write test"); };
globalThis.__cursorFetch = function(){ throw new Error("no read in write test"); };
globalThis.__cursorClose = function(){};
"#;

    fn eval_capture_write(user_js: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let ops: rquickjs::String = ctx.eval("__lastWriteOps || \"\"").unwrap();
            ops.to_string().unwrap()
        })
    }

    fn eval_capture_run_command(user_js: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let cmd: rquickjs::String = ctx.eval("__lastCmd || \"\"").unwrap();
            cmd.to_string().unwrap()
        })
    }

    #[test]
    fn insert_one_builds_single_op_payload() {
        let payload = eval_capture_write(r#"db.c.insertOne({a:1})"#);
        assert!(payload.contains(r#""op":"insertOne""#));
        assert!(payload.contains(r#""ordered":true"#) || !payload.contains("ordered"));
        assert!(payload.contains(r#""a":1"#));
    }

    #[test]
    fn update_one_passes_upsert_flag() {
        let payload = eval_capture_write(r#"db.c.updateOne({a:1},{$set:{b:2}},{upsert:true})"#);
        assert!(payload.contains(r#""op":"updateOne""#));
        assert!(payload.contains(r#""upsert":true"#));
    }

    #[test]
    fn bulk_builder_collects_ops_in_order() {
        let payload = eval_capture_write(
            r#"var b=db.c.initializeOrderedBulkOp();b.insert({a:1});b.find({a:1}).updateOne({$set:{a:2}});b.find({a:2}).remove();b.execute()"#,
        );
        assert!(payload.contains(r#""ordered":true"#));
        // three ops, in order
        let i_ins = payload.find("insertOne").unwrap();
        let i_upd = payload.find("updateOne").unwrap();
        let i_del = payload.find("deleteMany").unwrap();
        assert!(i_ins < i_upd && i_upd < i_del);
    }

    #[test]
    fn unordered_bulk_sets_ordered_false() {
        let payload = eval_capture_write(
            r#"var b=db.c.initializeUnorderedBulkOp();b.insert({a:1});b.execute()"#,
        );
        assert!(payload.contains(r#""ordered":false"#));
    }

    #[test]
    fn find_one_and_delete_builds_find_and_modify_command() {
        let cmd = eval_capture_run_command(r#"db.c.findOneAndDelete({a:1})"#);
        assert!(cmd.contains(r#""findAndModify""#) || cmd.contains(r#""findandmodify""#));
        assert!(cmd.contains(r#""remove":true"#));
    }
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
mod write_ops_tests {
    use super::*;

    #[test]
    fn ensure_writable_blocks_when_read_only() {
        assert!(ensure_writable(true).is_err());
        assert!(ensure_writable(false).is_ok());
    }

    #[test]
    fn parse_ordered_default_true() {
        let (ordered, ops) =
            parse_write_ops(r#"{"ops":[{"op":"deleteOne","filter":{"a":1}}]}"#).unwrap();
        assert!(ordered);
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], WriteOp::DeleteOne(_)));
    }

    #[test]
    fn parse_unordered_flag() {
        let (ordered, _) =
            parse_write_ops(r#"{"ordered":false,"ops":[{"op":"insertOne","document":{}}]}"#)
                .unwrap();
        assert!(!ordered);
    }

    #[test]
    fn parse_rejects_unknown_op() {
        assert!(parse_write_ops(r#"{"ops":[{"op":"frobnicate"}]}"#).is_err());
    }

    #[test]
    fn parse_rejects_non_array_ops() {
        assert!(parse_write_ops(r#"{"ops":{}}"#).is_err());
    }

    #[test]
    fn build_ack_serializes_counts_and_ids() {
        let mut a = WriteAccum::default();
        a.inserted_count = 2;
        a.matched_count = 1;
        a.modified_count = 1;
        a.deleted_count = 3;
        a.inserted_ids.push(r#"{"$oid":"507f1f77bcf86cd799439011"}"#.into());
        let json = a.build_ack();
        assert!(json.contains(r#""insertedCount":{"$numberLong":"2"}"#));
        assert!(json.contains(r#""deletedCount":{"$numberLong":"3"}"#));
        assert!(json.contains(r#""$oid":"507f1f77bcf86cd799439011""#));
    }

    #[test]
    fn build_ack_serializes_upsert_path() {
        let mut a = WriteAccum::default();
        a.matched_count = 0;
        a.modified_count = 0;
        a.upserted_count = 1;
        a.upserted_ids.push(r#"{"$oid":"aabbccddeeff001122334455"}"#.into());
        let json = a.build_ack();
        assert!(json.contains(r#""upsertedCount":{"$numberLong":"1"}"#));
        assert!(json.contains(r#""$oid":"aabbccddeeff001122334455""#));
        assert!(json.contains(r#""upsertedIds""#));
    }

    #[test]
    fn insert_many_rejects_non_document_element() {
        assert!(parse_write_ops(r#"{"ops":[{"op":"insertMany","documents":[{"a":1},2]}]}"#).is_err());
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
                  "dropIndexes", "createUser", "dropUser"] {
            assert!(is_write_command(&doc! { k: 1 }), "{k} should be a write");
        }
    }

    #[test]
    fn case_insensitive_first_key() {
        assert!(is_write_command(&doc! { "DropDatabase": 1 }));
    }

    #[test]
    fn read_commands_are_allowed() {
        for k in ["find", "aggregate", "count", "distinct", "dbStats",
                  "collStats", "listCollections", "ping", "buildInfo", "serverStatus"] {
            assert!(!is_write_command(&doc! { k: 1 }), "{k} should be allowed");
        }
    }

    #[test]
    fn empty_command_is_not_a_write() {
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
