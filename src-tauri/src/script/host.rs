//! QuickJS host context and global function bindings for the script engine.
//!
//! `HostCtx` carries the MongoDB client, Tokio handle, console sink, cursor registry, and
//! row-cap for a single script run. `bind(ctx, host)` registers all `__xxx` globals that
//! the JS prelude (Task 6) calls.
use crate::script::cursors::CursorStore;
use crate::script::outcome::ConsoleEntry;
use mongodb::{bson::Document, Client};
use rquickjs::{Ctx, Exception, Function, Result as JsResult};
use std::cell::RefCell;
use std::rc::Rc;
use tokio::runtime::Handle;

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
}

// ── Error helper ─────────────────────────────────────────────────────────────

/// Convert any displayable error into a thrown JS exception.
fn to_js_err<'js>(ctx: &Ctx<'js>, e: impl ToString) -> rquickjs::Error {
    Exception::throw_message(ctx, &e.to_string())
}

// ── bind ─────────────────────────────────────────────────────────────────────

/// Register all `__xxx` globals into `ctx`.
pub fn bind(ctx: &Ctx<'_>, host: HostCtx) -> JsResult<()> {
    bind_find(ctx, host.clone())?;
    bind_aggregate(ctx, host.clone())?;
    bind_count(ctx, host.clone())?;
    bind_distinct(ctx, host.clone())?;
    bind_run_command(ctx, host.clone())?;
    bind_list_collections(ctx, host.clone())?;
    bind_cursor_fetch(ctx, host.clone())?;
    bind_cursor_close(ctx, host.clone())?;
    bind_print(ctx, host)?;
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
            let result = h.handle.block_on(async move {
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
            });

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
            let result = h.handle.block_on(async move {
                use crate::json_bson::canonical_string_to_doc_array;
                use crate::json_bson::canonical_string_to_doc;
                use mongodb::bson::Bson;
                use mongodb::options::AggregateOptions;

                let pipeline =
                    canonical_string_to_doc_array(&pipeline_json, "pipeline must be array", "pipeline stage must be a document")?;

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
            });

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
            let result = h.handle.block_on(async move {
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
            });

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
            let result = h.handle.block_on(async move {
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
            });

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
            let result = h.handle.block_on(async move {
                use crate::bson_json::doc_to_canonical_string;

                let cmd = crate::json_bson::canonical_string_to_doc(&cmd_json)?;
                let reply = h
                    .client
                    .database(&db)
                    .run_command(cmd)
                    .await
                    .map_err(|e| crate::error::AppError::Query(e.to_string()))?;
                doc_to_canonical_string(reply)
            });

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
            let result = h.handle.block_on(async move {
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
            });

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
            let result = h.handle.block_on(async move {
                let mut store = h.cursors.borrow_mut();
                let (rows, exhausted) = store.fetch(handle, n).await?;
                let rows_json = rows.join(",");
                Ok::<String, crate::error::AppError>(format!(
                    r#"{{"rows":[{rows_json}],"exhausted":{exhausted}}}"#
                ))
            });

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
