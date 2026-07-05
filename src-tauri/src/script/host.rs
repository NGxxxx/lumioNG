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
    /// Maximum number of rows returned per cursor open (cap for result display). `0` = unlimited.
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
    "createcollection", "createview", "createindex", "reindex",
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

use crate::error::ensure_writable;

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
    bind_admin_command(ctx, host.clone())?;
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

                    let mut cursor = collection
                        .find(filter)
                        .with_options(find_opts)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    let batch_size = if h.cap == 0 { 101 } else { h.cap.min(101) };
                    // Drain the first batch on the owned cursor, then store only if more remains —
                    // never holds the cursors RefCell borrow across `.await`.
                    let (rows, exhausted) =
                        crate::script::cursors::CursorStore::drain(&mut cursor, batch_size).await?;
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

                    let mut cursor = collection
                        .aggregate(pipeline)
                        .with_options(agg_opts)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;

                    let batch_size = if h.cap == 0 { 101 } else { h.cap.min(101) };
                    // Drain on the owned cursor first; store only if more remains (no RefCell across await).
                    let (rows, exhausted) =
                        crate::script::cursors::CursorStore::drain(&mut cursor, batch_size).await?;
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

// ── __adminCommand ──────────────────────────────────────────────────────────────

fn bind_admin_command(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    let h = host.clone();
    // args: cmdJson — always runs against the `admin` database.
    let f = Function::new(
        ctx.clone(),
        move |ctx: Ctx<'_>, cmd_json: String| -> JsResult<String> {
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
                        .database("admin")
                        .run_command(cmd)
                        .await
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                    doc_to_canonical_string(reply)
                },
            ));

            result.map_err(|e| to_js_err(&ctx, e))
        },
    )?;
    ctx.globals().set("__adminCommand", f)?;
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

                    // Serialize as a JSON array; serde handles quotes, backslashes, control chars.
                    serde_json::to_string(&names)
                        .map_err(|e| crate::error::AppError::Query(e.to_string()))
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
                    // Take the cursor out so the RefCell isn't borrowed across `.await`.
                    let taken = h.cursors.borrow_mut().take(handle);
                    let mut cursor = match taken {
                        Some(c) => c,
                        None => return Err(crate::error::AppError::Query("unknown cursor".into())),
                    };
                    let (rows, exhausted) =
                        crate::script::cursors::CursorStore::drain(&mut cursor, n).await?;
                    if !exhausted {
                        h.cursors.borrow_mut().put(handle, cursor);
                    }
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
    fn write_op_payloads_carry_op_kind_and_flags() {
        // insertOne: single op, default-ordered, payload preserves the document.
        let ins = eval_capture_write(r#"db.c.insertOne({a:1})"#);
        assert!(ins.contains(r#""op":"insertOne""#));
        assert!(ins.contains(r#""ordered":true"#) || !ins.contains("ordered"));
        assert!(ins.contains(r#""a":1"#));
        // updateOne threads the upsert flag through.
        let upd = eval_capture_write(r#"db.c.updateOne({a:1},{$set:{b:2}},{upsert:true})"#);
        assert!(upd.contains(r#""op":"updateOne""#));
        assert!(upd.contains(r#""upsert":true"#));
    }

    #[test]
    fn bulk_builder_preserves_order_and_ordered_flag() {
        // ordered bulk: ops appear in insertion order, ordered:true.
        let ordered = eval_capture_write(
            r#"var b=db.c.initializeOrderedBulkOp();b.insert({a:1});b.find({a:1}).updateOne({$set:{a:2}});b.find({a:2}).remove();b.execute()"#,
        );
        assert!(ordered.contains(r#""ordered":true"#));
        let i_ins = ordered.find("insertOne").unwrap();
        let i_upd = ordered.find("updateOne").unwrap();
        let i_del = ordered.find("deleteMany").unwrap();
        assert!(i_ins < i_upd && i_upd < i_del);
        // unordered bulk flips the flag.
        let unordered = eval_capture_write(
            r#"var b=db.c.initializeUnorderedBulkOp();b.insert({a:1});b.execute()"#,
        );
        assert!(unordered.contains(r#""ordered":false"#));
    }

    /// DDL / index / findAndModify prelude helpers each build the documented command document.
    /// Table-driven: one row per helper, asserting the substrings that must appear in the command.
    #[test]
    fn prelude_helpers_build_expected_command_shapes() {
        let cases: &[(&str, &[&str])] = &[
            (
                r#"db.c.createIndex({a:1},{name:"a_1",unique:true})"#,
                &[r#""createIndexes":"c""#, r#""name":"a_1""#, r#""unique":true"#],
            ),
            (r#"db.c.dropIndex("a_1")"#, &[r#""dropIndexes":"c""#, r#""index":"a_1""#]),
            (r#"db.c.getIndexes()"#, &[r#""listIndexes":"c""#]),
            (r#"db.c.hideIndex("a_1")"#, &[r#""collMod":"c""#, r#""hidden":true"#]),
            (r#"db.c.reIndex()"#, &[r#""reIndex":"c""#]),
            (r#"db.c.drop()"#, &[r#""drop":"c""#]),
            (
                r#"db.c.renameCollection("c2", true)"#,
                &[r#""renameCollection":"testdb.c""#, r#""to":"testdb.c2""#, r#""dropTarget":true"#],
            ),
        ];
        for (script, expected) in cases {
            let cmd = eval_capture_run_command(script);
            for needle in *expected {
                assert!(cmd.contains(needle), "`{script}` command missing `{needle}`, got: {cmd}");
            }
        }
        // findOneAndDelete uses the find-and-modify command (casing tolerant) with remove:true.
        let fam = eval_capture_run_command(r#"db.c.findOneAndDelete({a:1})"#);
        assert!(fam.contains(r#""findAndModify""#) || fam.contains(r#""findandmodify""#));
        assert!(fam.contains(r#""remove":true"#));
        // createIndex key may serialize as either plain or ExtJSON int.
        let ci = eval_capture_run_command(r#"db.c.createIndex({a:1})"#);
        assert!(ci.contains(r#""key":{"a":1}"#) || ci.contains(r#""key":{"a":{"$numberInt":"1"}}"#));
    }
}

#[cfg(test)]
mod prelude_read_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("prelude.js");

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
        // The common path (no hasNext) is unchanged: exactly one open.
        let opens = eval_int(r#"var c = db.c.find(); var r = __finalize(c);"#, "__openCount");
        assert_eq!(opens, 1);
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
    fn parse_ordered_flag_and_op_kind() {
        // Default ordered:true, op materialized to the right WriteOp variant.
        let (ordered, ops) =
            parse_write_ops(r#"{"ops":[{"op":"deleteOne","filter":{"a":1}}]}"#).unwrap();
        assert!(ordered);
        assert_eq!(ops.len(), 1);
        assert!(matches!(ops[0], WriteOp::DeleteOne(_)));
        // Explicit ordered:false honored.
        let (ordered, _) =
            parse_write_ops(r#"{"ordered":false,"ops":[{"op":"insertOne","document":{}}]}"#)
                .unwrap();
        assert!(!ordered);
    }

    #[test]
    fn parse_rejects_malformed_payloads() {
        assert!(parse_write_ops(r#"{"ops":[{"op":"frobnicate"}]}"#).is_err()); // unknown op
        assert!(parse_write_ops(r#"{"ops":{}}"#).is_err()); // ops not an array
        // insertMany element that is not a document
        assert!(parse_write_ops(r#"{"ops":[{"op":"insertMany","documents":[{"a":1},2]}]}"#).is_err());
    }

    #[test]
    fn build_ack_serializes_counts_and_both_id_arrays() {
        let mut a = WriteAccum::default();
        a.inserted_count = 2;
        a.matched_count = 1;
        a.modified_count = 1;
        a.deleted_count = 3;
        a.upserted_count = 1;
        a.inserted_ids.push(r#"{"$oid":"507f1f77bcf86cd799439011"}"#.into());
        a.upserted_ids.push(r#"{"$oid":"aabbccddeeff001122334455"}"#.into());
        let json = a.build_ack();
        assert!(json.contains(r#""insertedCount":{"$numberLong":"2"}"#));
        assert!(json.contains(r#""deletedCount":{"$numberLong":"3"}"#));
        assert!(json.contains(r#""upsertedCount":{"$numberLong":"1"}"#));
        assert!(json.contains(r#""$oid":"507f1f77bcf86cd799439011""#));
        assert!(json.contains(r#""$oid":"aabbccddeeff001122334455""#));
        assert!(json.contains(r#""upsertedIds""#));
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

#[cfg(test)]
mod prelude_admin_tests {
    use rquickjs::{Context, Runtime};

    const PRELUDE: &str = include_str!("prelude.js");

    // Captures the db + command sent to __runCommand and the command sent to __adminCommand.
    // Returns a canned reply rich enough for chained helpers (stats fields, replSet config, cursor).
    const ADMIN_STUBS: &str = r#"
globalThis.__lastCmdDb = null;
globalThis.__lastCmd = null;
globalThis.__lastAdminCmd = null;
globalThis.__lastAggPipeline = null;
function __reply(){
  return JSON.stringify({
    ok: 1, version: "7.0.0",
    size: {$numberLong:"100"}, storageSize: {$numberLong:"200"},
    totalIndexSize: {$numberLong:"50"}, count: {$numberLong:"3"}, capped: false,
    config: {_id:"rs0", version: 1, members: [{_id:0, host:"h0:27017"}]},
    cursor: {firstBatch: []}, value: null,
    logComponentVerbosity: {verbosity: 0}, shards: []
  });
}
globalThis.__runCommand = function(db, cmd){ __lastCmdDb = db; __lastCmd = cmd; return __reply(); };
globalThis.__adminCommand = function(cmd){ __lastAdminCmd = cmd; return __reply(); };
globalThis.__aggregate = function(db, coll, pipeline, opts){
  __lastAggPipeline = pipeline;
  return JSON.stringify({handle: 1, rows: [], exhausted: true});
};
globalThis.__cursorFetch = function(){ return JSON.stringify({rows: [], exhausted: true}); };
globalThis.__cursorClose = function(){};
globalThis.__find = function(){ return JSON.stringify({handle: 1, rows: [], exhausted: true}); };
globalThis.__count = function(){ return JSON.stringify({$numberLong:"0"}); };
globalThis.__distinct = function(){ return "[]"; };
globalThis.__listCollections = function(){ return "[]"; };
globalThis.__write = function(){ return JSON.stringify({acknowledged:true}); };
globalThis.__print = function(){};
globalThis.__DBNAME = "testdb";
"#;

    /// Eval the prelude + user JS, then return the string value of `expr`
    /// (e.g. "__lastCmd", "__lastAdminCmd", "String(db.c.dataSize())").
    fn capture(user_js: &str, expr: &str) -> String {
        let rt = Runtime::new().unwrap();
        let ctx = Context::full(&rt).unwrap();
        ctx.with(|ctx| {
            ctx.eval::<(), _>(ADMIN_STUBS).unwrap();
            ctx.eval::<(), _>(PRELUDE).unwrap();
            ctx.eval::<(), _>(user_js).unwrap();
            let v: rquickjs::String = ctx.eval(expr).unwrap();
            v.to_string().unwrap()
        })
    }

    #[test]
    fn admin_command_global_is_callable_from_prelude() {
        // db.adminCommand routes through __adminCommand (added in Task 3, but the host stub
        // exists now). This smoke-tests the harness itself.
        let got = capture(r#"db.runCommand({ping:1})"#, "__lastCmd");
        assert!(got.contains(r#""ping":1"#) || got.contains(r#""ping":{"$numberInt":"1"}"#));
        assert_eq!(capture(r#"db.runCommand({ping:1})"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn db_stats_builds_dbstats_with_scale() {
        assert!(capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""dbStats":1"#));
        assert!(capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""scale":{"$numberInt":"1024"}"#)
             || capture(r#"db.stats(1024)"#, "__lastCmd").contains(r#""scale":1024"#));
        assert_eq!(capture(r#"db.stats()"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn server_status_routes_to_admin() {
        assert!(capture(r#"db.serverStatus()"#, "__lastAdminCmd").contains(r#""serverStatus":1"#));
    }

    #[test]
    fn kill_op_builds_killop_command_on_admin() {
        let c = capture(r#"db.killOp(123)"#, "__lastAdminCmd");
        assert!(c.contains(r#""killOp":1"#));
        assert!(c.contains(r#""op":"#));
    }

    #[test]
    fn version_returns_build_info_version_string() {
        assert_eq!(capture(r#"db.version()"#, "String(db.version())"), "7.0.0");
    }

    #[test]
    fn set_profiling_level_builds_profile_command() {
        let c = capture(r#"db.setProfilingLevel(1, {slowms: 50})"#, "__lastCmd");
        assert!(c.contains(r#""profile":{"$numberInt":"1"}"#) || c.contains(r#""profile":1"#));
        assert!(c.contains(r#""slowms":{"$numberInt":"50"}"#) || c.contains(r#""slowms":50"#));
    }

    #[test]
    fn create_collection_builds_create_command() {
        let c = capture(r#"db.createCollection("logs", {capped:true, size:1000})"#, "__lastCmd");
        assert!(c.contains(r#""create":"logs""#));
        assert!(c.contains(r#""capped":true"#));
    }

    #[test]
    fn create_view_builds_create_with_viewon_and_pipeline() {
        let c = capture(r#"db.createView("v","src",[{$match:{a:1}}])"#, "__lastCmd");
        assert!(c.contains(r#""create":"v""#));
        assert!(c.contains(r#""viewOn":"src""#));
        assert!(c.contains(r#""pipeline":[{"$match""#));
    }

    #[test]
    fn drop_database_builds_dropdatabase_command() {
        assert!(capture(r#"db.dropDatabase()"#, "__lastCmd").contains(r#""dropDatabase":1"#));
    }

    #[test]
    fn get_collection_infos_builds_list_collections_with_filter() {
        let c = capture(r#"db.getCollectionInfos({type:"view"})"#, "__lastCmd");
        assert!(c.contains(r#""listCollections":1"#));
        assert!(c.contains(r#""filter":{"type":"view"}"#));
    }

    #[test]
    fn coll_stats_builds_collstats_command() {
        let c = capture(r#"db.c.stats()"#, "__lastCmd");
        assert!(c.contains(r#""collStats":"c""#));
    }

    #[test]
    fn data_size_coerces_numberlong_to_number() {
        // stub size is {$numberLong:"100"}
        assert_eq!(capture(r#"db.c.dataSize()"#, "String(db.c.dataSize())"), "100");
    }

    #[test]
    fn total_size_sums_storage_and_index() {
        // storageSize 200 + totalIndexSize 50 = 250
        assert_eq!(capture(r#"db.c.totalSize()"#, "String(db.c.totalSize())"), "250");
    }

    #[test]
    fn validate_builds_validate_command() {
        let c = capture(r#"db.c.validate({full:true})"#, "__lastCmd");
        assert!(c.contains(r#""validate":"c""#));
        assert!(c.contains(r#""full":true"#));
    }

    #[test]
    fn latency_stats_builds_collstats_aggregation() {
        capture(r#"db.c.latencyStats()"#, "__lastAggPipeline");
        let p = capture(r#"db.c.latencyStats()"#, "JSON.stringify(__lastAggPipeline)");
        assert!(p.contains(r#"$collStats"#));
        assert!(p.contains(r#"latencyStats"#));
    }

    #[test]
    fn cursor_explain_builds_explain_find_command() {
        let c = capture(r#"db.c.find({a:1}).explain("executionStats")"#, "__lastCmd");
        assert!(c.contains(r#""explain":{"#));
        assert!(c.contains(r#""find":"c""#));
        assert!(c.contains(r#""verbosity":"executionStats""#));
    }

    #[test]
    fn coll_explain_aggregate_builds_explain_aggregate_command() {
        let c = capture(r#"db.c.explain().aggregate([{$match:{a:1}}])"#, "__lastCmd");
        assert!(c.contains(r#""explain":{"#));
        assert!(c.contains(r#""aggregate":"c""#));
    }

    #[test]
    fn create_user_builds_create_user_command() {
        let c = capture(r#"db.createUser({user:"alice", pwd:"pw", roles:["readWrite"]})"#, "__lastCmd");
        assert!(c.contains(r#""createUser":"alice""#));
        assert!(c.contains(r#""pwd":"pw""#));
        assert!(c.contains(r#""roles":["readWrite"]"#));
        assert_eq!(capture(r#"db.createUser({user:"alice", pwd:"pw", roles:[]})"#, "__lastCmdDb"), "testdb");
    }

    #[test]
    fn drop_user_and_drop_all_users() {
        assert!(capture(r#"db.dropUser("bob")"#, "__lastCmd").contains(r#""dropUser":"bob""#));
        assert!(capture(r#"db.dropAllUsers()"#, "__lastCmd").contains(r#""dropAllUsersFromDatabase":1"#));
    }

    #[test]
    fn change_user_password_builds_update_user() {
        let c = capture(r#"db.changeUserPassword("bob","newpw")"#, "__lastCmd");
        assert!(c.contains(r#""updateUser":"bob""#));
        assert!(c.contains(r#""pwd":"newpw""#));
    }

    #[test]
    fn grant_roles_to_user_command() {
        let c = capture(r#"db.grantRolesToUser("bob",["read"])"#, "__lastCmd");
        assert!(c.contains(r#""grantRolesToUser":"bob""#));
        assert!(c.contains(r#""roles":["read"]"#));
    }

    #[test]
    fn get_user_builds_users_info_with_db() {
        let c = capture(r#"db.getUser("bob")"#, "__lastCmd");
        assert!(c.contains(r#""usersInfo":{"user":"bob","db":"testdb"}"#));
    }

    #[test]
    fn create_role_builds_create_role_command() {
        let c = capture(r#"db.createRole({role:"r1", privileges:[], roles:[]})"#, "__lastCmd");
        assert!(c.contains(r#""createRole":"r1""#));
        assert!(c.contains(r#""privileges":[]"#));
    }

    #[test]
    fn drop_role_and_drop_all_roles() {
        assert!(capture(r#"db.dropRole("r1")"#, "__lastCmd").contains(r#""dropRole":"r1""#));
        assert!(capture(r#"db.dropAllRoles()"#, "__lastCmd").contains(r#""dropAllRolesFromDatabase":1"#));
    }

    #[test]
    fn grant_privileges_to_role_command() {
        let c = capture(r#"db.grantPrivilegesToRole("r1",[{resource:{db:"d",collection:""},actions:["find"]}])"#, "__lastCmd");
        assert!(c.contains(r#""grantPrivilegesToRole":"r1""#));
        assert!(c.contains(r#""privileges":[{"#));
    }

    #[test]
    fn get_role_builds_roles_info_with_db() {
        let c = capture(r#"db.getRole("r1")"#, "__lastCmd");
        assert!(c.contains(r#""rolesInfo":{"role":"r1","db":"testdb"}"#));
    }

    #[test]
    fn rs_status_and_conf_route_to_admin() {
        assert!(capture(r#"rs.status()"#, "__lastAdminCmd").contains(r#""replSetGetStatus":1"#));
        assert!(capture(r#"rs.conf()"#, "__lastAdminCmd").contains(r#""replSetGetConfig":1"#));
    }

    #[test]
    fn rs_initiate_and_reconfig_commands() {
        assert!(capture(r#"rs.initiate({_id:"rs0",members:[]})"#, "__lastAdminCmd").contains(r#""replSetInitiate":{"#));
        let c = capture(r#"rs.reconfig({_id:"rs0",version:2,members:[]}, {force:true})"#, "__lastAdminCmd");
        assert!(c.contains(r#""replSetReconfig":{"#));
        assert!(c.contains(r#""force":true"#));
    }

    #[test]
    fn rs_add_reads_conf_then_reconfigs_with_new_host() {
        // conf() stub returns config with member h0; add("h1:27017") must reconfig including h1.
        let c = capture(r#"rs.add("h1:27017")"#, "__lastAdminCmd");
        assert!(c.contains(r#""replSetReconfig":{"#));
        assert!(c.contains("h1:27017"));
    }

    #[test]
    fn rs_step_down_and_freeze_commands() {
        assert!(capture(r#"rs.freeze(120)"#, "__lastAdminCmd").contains(r#""replSetFreeze""#));
        assert!(capture(r#"rs.stepDown(60)"#, "__lastAdminCmd").contains(r#""replSetStepDown""#));
    }

    #[test]
    fn sh_enable_sharding_and_shard_collection() {
        assert!(capture(r#"sh.enableSharding("mydb")"#, "__lastAdminCmd").contains(r#""enableSharding":"mydb""#));
        let c = capture(r#"sh.shardCollection("mydb.c",{x:1},true)"#, "__lastAdminCmd");
        assert!(c.contains(r#""shardCollection":"mydb.c""#));
        assert!(c.contains(r#""key":{"x""#));
        assert!(c.contains(r#""unique":true"#));
    }

    #[test]
    fn sh_add_shard_and_move_chunk() {
        assert!(capture(r#"sh.addShard("rs1/h:27017")"#, "__lastAdminCmd").contains(r#""addShard":"rs1/h:27017""#));
        let c = capture(r#"sh.moveChunk("mydb.c",{x:5},"shard0001")"#, "__lastAdminCmd");
        assert!(c.contains(r#""moveChunk":"mydb.c""#));
        assert!(c.contains(r#""find":{"x""#));
        assert!(c.contains(r#""to":"shard0001""#));
    }

    #[test]
    fn sh_split_and_balancer_controls() {
        assert!(capture(r#"sh.splitAt("mydb.c",{x:5})"#, "__lastAdminCmd").contains(r#""split":"mydb.c""#));
        assert!(capture(r#"sh.startBalancer()"#, "__lastAdminCmd").contains(r#""balancerStart":1"#));
        assert!(capture(r#"sh.stopBalancer()"#, "__lastAdminCmd").contains(r#""balancerStop":1"#));
        assert!(capture(r#"sh.isBalancerRunning()"#, "__lastAdminCmd").contains(r#""balancerStatus":1"#));
    }

    #[test]
    fn sh_zone_management_commands() {
        assert!(capture(r#"sh.addShardToZone("shard0","z1")"#, "__lastAdminCmd").contains(r#""addShardToZone":"shard0""#));
        let c = capture(r#"sh.updateZoneKeyRange("mydb.c",{x:0},{x:10},"z1")"#, "__lastAdminCmd");
        assert!(c.contains(r#""updateZoneKeyRange":"mydb.c""#));
        assert!(c.contains(r#""zone":"z1""#));
    }

    #[test]
    fn slice4_ddl_writes_are_in_denylist() {
        use mongodb::bson::doc;
        for k in ["create", "createView", "dropDatabase", "renameCollection",
                  "createUser", "updateUser", "createRole", "grantRolesToUser"] {
            assert!(super::is_write_command(&doc! { k: 1 }), "{k} must be read-only gated");
        }
    }

    #[test]
    fn slice4_cluster_admin_is_intentionally_not_gated() {
        use mongodb::bson::doc;
        // rs.*/sh.* reconfig is cluster admin, deliberately outside the data read-only lock.
        for k in ["replSetReconfig", "addShard", "moveChunk", "balancerStart"] {
            assert!(!super::is_write_command(&doc! { k: 1 }), "{k} is cluster-admin, not a data write");
        }
    }
}
