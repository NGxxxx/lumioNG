//! The MCP tool surface: what an AI client may do with the connections the user exposed. Read tools
//! are always on; write tools exist only while "Allow writes" is on, and even then never touch a
//! read-only or production-labelled connection. Results are Relaxed Extended JSON text — friendlier
//! for a model to read than the canonical form the app's own frontend uses.

use super::redact::{first_redacted_field, first_redacted_in_pipeline, redact_document};
use crate::audit::{AuditEntry, AuditError, SOURCE_MCP};
use crate::state::SessionMeta;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{AggregateOptions, FindOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// A connection the frontend chose to expose (every live session, labelled as the user sees it).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExposedSession {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub environment: String,
    #[serde(default)]
    pub read_only: bool,
    /// "off" | "read" | "write": what the user allowed MCP clients to do with this connection.
    #[serde(default = "default_access")]
    pub access: String,
}

fn default_access() -> String {
    crate::registry::MCP_ACCESS_READ.to_string()
}

pub struct ToolCtx<'a> {
    pub state: &'a AppState,
    pub sessions: &'a [ExposedSession],
    pub allow_writes: bool,
    /// Field-name patterns whose values are replaced with "[redacted]" in results (see `mcp::redact`).
    pub redact: &'a [String],
    /// Also audit read tool calls (writes are always audited).
    pub audit_reads: bool,
}

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;
const DEFAULT_SAMPLE: i64 = 100;
const MAX_SAMPLE: i64 = 1000;
const MAX_INSERT: usize = 1000;
const OP_TIMEOUT: Duration = Duration::from_secs(30);
/// Tool output cap: a model's context is the real limit, and a runaway result helps nobody.
const MAX_OUTPUT: usize = 200 * 1024;

/// Sentinel for "no count recorded" in the per-call affected-documents counter.
const NO_COUNT: u64 = u64::MAX;

const WRITE_TOOLS: [&str; 3] = ["insert_documents", "update_documents", "delete_documents"];

fn ns_props() -> Value {
    json!({
        "connection": { "type": "string", "description": "Connection id or label from list_connections. Optional when only one connection is open." },
        "database": { "type": "string" },
        "collection": { "type": "string" }
    })
}

fn tool(name: &str, description: &str, extra: Value, required: &[&str], read_only: bool) -> Value {
    let mut props = ns_props();
    let props_obj = props.as_object_mut().expect("object");
    if let Value::Object(e) = extra {
        props_obj.extend(e);
    }
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required },
        "annotations": { "readOnlyHint": read_only, "destructiveHint": !read_only && name == "delete_documents" }
    })
}

/// Tool definitions for `tools/list`; write tools only while writes are allowed.
pub fn tool_list(allow_writes: bool) -> Vec<Value> {
    let filter = json!({ "type": "object", "description": "MongoDB query filter (Extended JSON allowed, e.g. {\"_id\": {\"$oid\": \"…\"}})." });
    let mut tools = vec![
        json!({
            "name": "list_connections",
            "description": "List the MongoDB connections currently open in LumioNG and exposed to MCP.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        }),
        tool("list_databases", "List the databases of a connection.", json!({}), &[], true),
        tool("list_collections", "List the collections (and views) of a database.", json!({}), &["database"], true),
        tool(
            "find",
            "Find documents in a collection. Returns at most 100 documents as Relaxed Extended JSON.",
            json!({
                "filter": filter,
                "projection": { "type": "object" },
                "sort": { "type": "object" },
                "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT },
                "skip": { "type": "integer", "minimum": 0 }
            }),
            &["database", "collection"],
            true,
        ),
        tool(
            "aggregate",
            "Run an aggregation pipeline. $out/$merge are refused unless writes are allowed. Returns at most 100 documents.",
            json!({
                "pipeline": { "type": "array", "items": { "type": "object" } },
                "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT, "default": DEFAULT_LIMIT }
            }),
            &["database", "collection", "pipeline"],
            true,
        ),
        tool("count_documents", "Count the documents matching a filter.", json!({ "filter": filter }), &["database", "collection"], true),
        tool(
            "collection_schema",
            "Infer a collection's schema from a random sample: every field path with its BSON types and how often it is present.",
            json!({ "sampleSize": { "type": "integer", "minimum": 1, "maximum": MAX_SAMPLE, "default": DEFAULT_SAMPLE } }),
            &["database", "collection"],
            true,
        ),
        tool("list_indexes", "List a collection's indexes.", json!({}), &["database", "collection"], true),
        tool(
            "explain",
            "Show how MongoDB would run a find (or an aggregation when `pipeline` is given) without running it: the winning plan's stages and the index each uses (queryPlanner verbosity). Use it to check that a query is covered by an index.",
            json!({
                "filter": filter,
                "sort": { "type": "object" },
                "projection": { "type": "object" },
                "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT },
                "pipeline": { "type": "array", "items": { "type": "object" }, "description": "Explain this aggregation instead of a find." }
            }),
            &["database", "collection"],
            true,
        ),
    ];
    if allow_writes {
        tools.push(tool(
            "insert_documents",
            "Insert documents into a collection (max 1000 per call).",
            json!({ "documents": { "type": "array", "items": { "type": "object" } } }),
            &["database", "collection", "documents"],
            false,
        ));
        tools.push(tool(
            "update_documents",
            "Update documents matching a non-empty filter. `update` is an update document ({\"$set\": …}) or a pipeline. Updates one document unless many=true.",
            json!({
                "filter": filter,
                "update": { "description": "Update document or aggregation pipeline array." },
                "many": { "type": "boolean", "default": false }
            }),
            &["database", "collection", "filter", "update"],
            false,
        ));
        tools.push(tool(
            "delete_documents",
            "Delete documents matching a non-empty filter. Deletes one document unless many=true.",
            json!({ "filter": filter, "many": { "type": "boolean", "default": false } }),
            &["database", "collection", "filter"],
            false,
        ));
    }
    tools
}

pub fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
}

// ── argument helpers ──

fn str_arg<'v>(args: &'v Value, key: &str) -> Result<&'v str, String> {
    match args.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Ok(s),
        _ => Err(format!("`{key}` is required and must be a non-empty string")),
    }
}

fn bool_arg(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn int_arg(args: &Value, key: &str, default: i64, min: i64, max: i64) -> Result<i64, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v.as_i64().map(|n| n.clamp(min, max)).ok_or_else(|| format!("`{key}` must be an integer")),
    }
}

/// An Extended JSON value from either a JSON value or a JSON string holding one (some clients send
/// nested objects as strings).
fn ext_value(v: &Value) -> Result<Bson, String> {
    let v = match v {
        Value::String(s) => serde_json::from_str::<Value>(s).map_err(|e| format!("invalid JSON: {e}"))?,
        other => other.clone(),
    };
    Bson::try_from(v).map_err(|e| format!("invalid Extended JSON: {e}"))
}

fn doc_arg(args: &Value, key: &str) -> Result<Option<Document>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match ext_value(v)? {
            Bson::Document(d) => Ok(Some(d)),
            _ => Err(format!("`{key}` must be an object")),
        },
    }
}

fn doc_array_arg(args: &Value, key: &str) -> Result<Vec<Document>, String> {
    match args.get(key).map(ext_value).transpose()? {
        Some(Bson::Array(items)) => items
            .into_iter()
            .map(|b| match b {
                Bson::Document(d) => Ok(d),
                _ => Err(format!("every element of `{key}` must be an object")),
            })
            .collect(),
        _ => Err(format!("`{key}` is required and must be an array of objects")),
    }
}

/// Picks the target connection: by id or (case-insensitive) label, or the only one when omitted.
pub fn resolve_session<'s>(sessions: &'s [ExposedSession], args: &Value) -> Result<&'s ExposedSession, String> {
    match args.get("connection").and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(want) => sessions
            .iter()
            .find(|s| s.id == want)
            .or_else(|| sessions.iter().find(|s| s.label.eq_ignore_ascii_case(want)))
            .ok_or_else(|| format!("no open connection named `{want}`; call list_connections")),
        None => match sessions {
            [] => Err("no connection is open in LumioNG".into()),
            [only] => Ok(only),
            _ => Err(format!(
                "several connections are open; pass `connection` (one of: {})",
                sessions.iter().map(|s| s.label.as_str()).collect::<Vec<_>>().join(", ")
            )),
        },
    }
}

/// Why a write on `s` must not run, or `None`. `meta` is the session's label, environment and
/// read-only flag as held by Rust; the frontend-supplied copies in `ExposedSession` are never trusted
/// for these, and a missing `meta` refuses the write.
fn writes_refused(ctx: &ToolCtx<'_>, s: &ExposedSession, meta: Option<&SessionMeta>) -> Option<String> {
    let Some(meta) = meta else {
        return Some(format!("connection `{}` has no live session state; refusing to write", s.label));
    };
    if !ctx.allow_writes {
        Some("writes are disabled in LumioNG's MCP settings".into())
    } else if s.access != "write" {
        Some(format!("connection `{}` is shared with MCP as `{}`; set its MCP access to write in the connection settings to allow writes", s.label, s.access))
    } else if meta.read_only {
        Some(format!("connection `{}` is read-only", s.label))
    } else if meta.environment == "prod" {
        Some(format!("connection `{}` is labelled production; MCP never writes to it", s.label))
    } else {
        None
    }
}

fn pipeline_writes(stages: &[Document]) -> bool {
    stages.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge"))
}

// ── output helpers ──

/// `relaxed` after replacing the values of fields matching `redact`.
fn relaxed_redacted(docs: Vec<Document>, redact: &[String]) -> Value {
    relaxed(docs.into_iter().map(|d| redact_document(d, redact)).collect())
}

fn relaxed(docs: Vec<Document>) -> Value {
    Value::Array(docs.into_iter().map(|d| Bson::Document(d).into_relaxed_extjson()).collect())
}

/// Pretty JSON, truncated to `MAX_OUTPUT` on a char boundary with a note saying so.
fn render(v: &Value) -> String {
    let text = serde_json::to_string_pretty(v).unwrap_or_else(|_| v.to_string());
    if text.len() <= MAX_OUTPUT {
        return text;
    }
    let mut cut = MAX_OUTPUT;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n… [output truncated at {} KB; narrow the query or lower `limit`]", &text[..cut], MAX_OUTPUT / 1024)
}

pub fn bson_type_name(b: &Bson) -> &'static str {
    match b {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binData",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Decimal128(_) => "decimal",
        Bson::Symbol(_) => "symbol",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

const SCHEMA_DEPTH: usize = 4;

fn walk(prefix: &str, d: &Document, depth: usize, out: &mut BTreeMap<String, (BTreeMap<&'static str, u64>, u64)>, seen: &mut Vec<String>) {
    for (k, v) in d {
        let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
        let entry = out.entry(path.clone()).or_default();
        *entry.0.entry(bson_type_name(v)).or_default() += 1;
        if !seen.contains(&path) {
            entry.1 += 1;
            seen.push(path.clone());
        }
        if depth + 1 < SCHEMA_DEPTH {
            match v {
                Bson::Document(sub) => walk(&path, sub, depth + 1, out, seen),
                // Arrays of subdocuments: dot paths reach into the elements, as in a query.
                Bson::Array(items) => {
                    for item in items {
                        if let Bson::Document(sub) = item {
                            walk(&path, sub, depth + 1, out, seen);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// `[{path, types: {type: count}, presence}]` over `docs`, presence being the share of documents
/// that have the path at all.
pub fn schema_summary(docs: &[Document]) -> Value {
    let mut fields: BTreeMap<String, (BTreeMap<&'static str, u64>, u64)> = BTreeMap::new();
    for d in docs {
        let mut seen = Vec::new();
        walk("", d, 0, &mut fields, &mut seen);
    }
    let n = docs.len().max(1) as f64;
    let list: Vec<Value> = fields
        .into_iter()
        .map(|(path, (types, present))| json!({ "path": path, "types": types, "presence": ((present as f64 / n) * 1000.0).round() / 1000.0 }))
        .collect();
    json!({ "sampled": docs.len(), "fields": list })
}

// ── dispatch ──

/// Runs one tool and returns its text result; `Err` becomes an `isError` tool result.
pub async fn call_tool(ctx: &ToolCtx<'_>, name: &str, args: &Value) -> Result<String, String> {
    if name == "list_connections" {
        let list: Vec<Value> = ctx
            .sessions
            .iter()
            .map(|s| json!({ "id": s.id, "label": s.label, "environment": s.environment, "readOnly": s.read_only, "access": s.access }))
            .collect();
        return Ok(render(&Value::Array(list)));
    }
    if is_write_tool(name) && !ctx.allow_writes {
        return Err(format!("unknown tool `{name}` (writes are disabled)"));
    }
    let session = resolve_session(ctx.sessions, args)?;
    let client = tool_client(ctx.state, &session.id).await.map_err(|e| e.to_string())?;
    // Filled in by the arms below so the audit line can carry the affected count and know whether
    // an `aggregate` turned out to write ($out/$merge).
    let count = AtomicU64::new(NO_COUNT);
    let wrote = AtomicBool::new(is_write_tool(name));
    // Environment and read-only flag come from Rust's own session record, not from the frontend list.
    let meta = ctx.state.meta(&session.id).await.ok();
    // Value-free failure summary for the audit line (server code + codeName, or a refusal reason).
    let audit_error: Mutex<Option<String>> = Mutex::new(None);
    // Destination of a writing aggregate (`$out` / `$merge`): (op, namespace).
    let write_target: Mutex<Option<(&'static str, String)>> = Mutex::new(None);
    let mongo_err = |e: mongodb::error::Error| {
        let text = e.to_string();
        *audit_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(crate::error::AppError::from(e).audit_summary());
        text
    };
    let refuse = |why: String| {
        *audit_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("Refused: {why}"));
        why
    };
    let run = async {
        match name {
            "list_databases" => {
                let names = client.list_database_names().await.map_err(|e| e.to_string())?;
                Ok(render(&json!(names)))
            }
            "list_collections" => {
                let db = client.database(str_arg(args, "database")?);
                let specs: Vec<_> = db.list_collections().await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
                let list: Vec<Value> = specs
                    .into_iter()
                    .map(|s| json!({ "name": s.name, "type": format!("{:?}", s.collection_type).to_lowercase() }))
                    .collect();
                Ok(render(&Value::Array(list)))
            }
            "find" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let filter = doc_arg(args, "filter")?.unwrap_or_default();
                let sort = doc_arg(args, "sort")?;
                refuse_redacted(ctx, [Some(&filter), sort.as_ref()])?;
                let limit = int_arg(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)?;
                let skip = int_arg(args, "skip", 0, 0, i64::MAX)?;
                let opts = FindOptions::builder()
                    .projection(doc_arg(args, "projection")?)
                    .sort(sort)
                    .limit(limit)
                    .skip(skip as u64)
                    .max_time(OP_TIMEOUT)
                    .build();
                let docs: Vec<Document> = coll.find(filter).with_options(opts).await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
                Ok(render(&relaxed_redacted(docs, ctx.redact)))
            }
            "aggregate" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let mut stages = doc_array_arg(args, "pipeline")?;
                refuse_redacted_pipeline(ctx, &stages)?;
                if pipeline_writes(&stages) {
                    wrote.store(true, Ordering::Relaxed);
                    *write_target.lock().unwrap_or_else(|p| p.into_inner()) =
                        crate::audit::pipeline_write_target(&stages, str_arg(args, "database")?, str_arg(args, "collection")?);
                    if let Some(why) = writes_refused(ctx, session, meta.as_ref()) {
                        return Err(refuse(format!("$out/$merge refused: {why}")));
                    }
                } else {
                    stages.push(doc! { "$limit": int_arg(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)? });
                }
                let opts = AggregateOptions::builder().max_time(OP_TIMEOUT).build();
                let docs: Vec<Document> = coll.aggregate(stages).with_options(opts).await.map_err(&mongo_err)?.try_collect().await.map_err(&mongo_err)?;
                Ok(render(&relaxed_redacted(docs, ctx.redact)))
            }
            "count_documents" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let filter = doc_arg(args, "filter")?.unwrap_or_default();
                refuse_redacted(ctx, [Some(&filter)])?;
                let n = coll.count_documents(filter).max_time(OP_TIMEOUT).await.map_err(|e| e.to_string())?;
                Ok(render(&json!({ "count": n })))
            }
            "collection_schema" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let size = int_arg(args, "sampleSize", DEFAULT_SAMPLE, 1, MAX_SAMPLE)?;
                let opts = AggregateOptions::builder().max_time(OP_TIMEOUT).build();
                let docs: Vec<Document> = coll
                    .aggregate(vec![doc! { "$sample": { "size": size } }])
                    .with_options(opts)
                    .await
                    .map_err(|e| e.to_string())?
                    .try_collect()
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(render(&schema_summary(&docs)))
            }
            "list_indexes" => {
                let raw: Vec<Document> = client
                    .database(str_arg(args, "database")?)
                    .run_cursor_command(doc! { "listIndexes": str_arg(args, "collection")? })
                    .await
                    .map_err(|e| e.to_string())?
                    .try_collect()
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(render(&relaxed(raw)))
            }
            "explain" => {
                let collection = str_arg(args, "collection")?;
                let filter = doc_arg(args, "filter")?.unwrap_or_default();
                let sort = doc_arg(args, "sort")?;
                refuse_redacted(ctx, [Some(&filter), sort.as_ref()])?;
                let inner = if args.get("pipeline").is_some_and(|p| !p.is_null()) {
                    let stages = doc_array_arg(args, "pipeline")?;
                    refuse_redacted_pipeline(ctx, &stages)?;
                    if pipeline_writes(&stages) {
                        return Err("explain does not accept $out/$merge pipelines".into());
                    }
                    doc! { "aggregate": collection, "pipeline": stages, "cursor": {}, "maxTimeMS": OP_TIMEOUT.as_millis() as i64 }
                } else {
                    let mut f = doc! { "find": collection, "filter": filter, "limit": int_arg(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)?, "maxTimeMS": OP_TIMEOUT.as_millis() as i64 };
                    if let Some(sort) = sort {
                        f.insert("sort", sort);
                    }
                    if let Some(projection) = doc_arg(args, "projection")? {
                        f.insert("projection", projection);
                    }
                    f
                };
                let reply = client
                    .database(str_arg(args, "database")?)
                    .run_command(doc! { "explain": inner, "verbosity": "queryPlanner" })
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(render(&plan_summary(&reply)))
            }
            "insert_documents" => {
                if let Some(why) = writes_refused(ctx, session, meta.as_ref()) {
                    return Err(refuse(why));
                }
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let docs = doc_array_arg(args, "documents")?;
                if docs.is_empty() || docs.len() > MAX_INSERT {
                    return Err(format!("`documents` must hold 1 to {MAX_INSERT} documents"));
                }
                let res = coll.insert_many(docs).await.map_err(&mongo_err)?;
                count.store(res.inserted_ids.len() as u64, Ordering::Relaxed);
                Ok(render(&json!({ "insertedCount": res.inserted_ids.len() })))
            }
            "update_documents" => {
                if let Some(why) = writes_refused(ctx, session, meta.as_ref()) {
                    return Err(refuse(why));
                }
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let filter = non_empty_filter(args)?;
                let update = match args.get("update").map(ext_value).transpose()? {
                    Some(Bson::Document(d)) if d.keys().next().is_some_and(|k| k.starts_with('$')) => mongodb::options::UpdateModifications::Document(d),
                    Some(Bson::Document(_)) => return Err("`update` must use update operators such as $set (use a pipeline to replace)".into()),
                    Some(Bson::Array(items)) => mongodb::options::UpdateModifications::Pipeline(
                        items.into_iter().map(|b| b.as_document().cloned().ok_or("every pipeline stage must be an object".to_string())).collect::<Result<_, _>>()?,
                    ),
                    _ => return Err("`update` is required: an update document or a pipeline array".into()),
                };
                let res = if bool_arg(args, "many") { coll.update_many(filter, update).await } else { coll.update_one(filter, update).await }
                    .map_err(&mongo_err)?;
                count.store(res.modified_count, Ordering::Relaxed);
                Ok(render(&json!({ "matchedCount": res.matched_count, "modifiedCount": res.modified_count })))
            }
            "delete_documents" => {
                if let Some(why) = writes_refused(ctx, session, meta.as_ref()) {
                    return Err(refuse(why));
                }
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let filter = non_empty_filter(args)?;
                let res = if bool_arg(args, "many") { coll.delete_many(filter).await } else { coll.delete_one(filter).await }.map_err(&mongo_err)?;
                count.store(res.deleted_count, Ordering::Relaxed);
                Ok(render(&json!({ "deletedCount": res.deleted_count })))
            }
            other => Err(format!("unknown tool `{other}`")),
        }
    };
    let outcome = run.await;
    if wrote.load(Ordering::Relaxed) || ctx.audit_reads {
        let n = count.load(Ordering::Relaxed);
        let summary = audit_error.into_inner().unwrap_or_else(|p| p.into_inner());
        let target = write_target.into_inner().unwrap_or_else(|p| p.into_inner());
        audit_call(ctx, session, meta.as_ref(), name, args, &outcome, (n != NO_COUNT).then_some(n), summary, target);
    }
    outcome
}

/// One audit line (source `mcp`) for a tool call that wrote, or tried to. Only the redacted filter is
/// kept, never the documents or update bodies the model sent, and a failure is recorded as a
/// value-free summary. A writing aggregate is recorded against its `$out`/`$merge` destination.
fn audit_call(
    ctx: &ToolCtx<'_>,
    session: &ExposedSession,
    meta: Option<&SessionMeta>,
    name: &str,
    args: &Value,
    outcome: &Result<String, String>,
    count: Option<u64>,
    error_summary: Option<String>,
    write_target: Option<(&'static str, String)>,
) {
    let field = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("");
    let (op, ns) = match write_target {
        Some((op, ns)) => (op.to_string(), ns),
        None => (name.to_string(), format!("{}.{}", field("database"), field("collection"))),
    };
    let filter = doc_arg(args, "filter").ok().flatten();
    let (label, environment) = match meta {
        Some(m) => (m.label.as_str(), m.environment.as_str()),
        None => (session.label.as_str(), session.environment.as_str()),
    };
    let entry = AuditEntry::new(SOURCE_MCP, &op, &ns).with_session(label, environment).with_filter(filter.as_ref());
    let entry = match outcome {
        Ok(_) => entry.with_count(count),
        Err(_) => entry.with_error(&error_summary.unwrap_or_else(|| "Rejected".into())),
    };
    if let Err(e) = ctx.state.audit.record(entry) {
        tracing::error!("audit log write failed: {e}");
    }
}

/// Refuses a query whose filter or sort names a redacted field: answers such as "how many documents
/// match password = …" would leak the very values redaction hides.
fn refuse_redacted<'d>(ctx: &ToolCtx<'_>, docs: impl IntoIterator<Item = Option<&'d Document>>) -> Result<(), String> {
    for d in docs.into_iter().flatten() {
        if let Some(field) = first_redacted_field(d, ctx.redact) {
            return Err(format!("`{field}` is a redacted field; queries cannot filter or sort on it"));
        }
    }
    Ok(())
}

/// Pipeline version of [`refuse_redacted`]: every stage, including field references like `"$password"`.
fn refuse_redacted_pipeline(ctx: &ToolCtx<'_>, stages: &[Document]) -> Result<(), String> {
    match first_redacted_in_pipeline(stages, ctx.redact) {
        Some(field) => Err(format!("`{field}` is a redacted field; pipelines cannot use it")),
        None => Ok(()),
    }
}

/// Plan stage keys worth showing a model; everything else (costs, bounds, SBE slots) is dropped.
const PLAN_KEYS: [&str; 9] = ["stage", "indexName", "keyPattern", "direction", "isMultiKey", "isUnique", "isSparse", "isPartial", "shardName"];
/// Keys that hold a child stage (or a list of them).
const PLAN_CHILDREN: [&str; 6] = ["inputStage", "inputStages", "queryPlan", "outerStage", "innerStage", "shards"];

fn compact_plan(b: &Bson) -> Value {
    match b {
        Bson::Document(d) => {
            let mut out = serde_json::Map::new();
            for k in PLAN_KEYS {
                if let Some(v) = d.get(k) {
                    out.insert(k.to_string(), v.clone().into_relaxed_extjson());
                }
            }
            for k in PLAN_CHILDREN {
                if let Some(v) = d.get(k) {
                    out.insert(k.to_string(), compact_plan(v));
                }
            }
            if let Some(w) = d.get("winningPlan") {
                out.insert("winningPlan".into(), compact_plan(w));
            }
            Value::Object(out)
        }
        Bson::Array(items) => Value::Array(items.iter().map(compact_plan).collect()),
        _ => Value::Null,
    }
}

/// `{namespace, winningPlan, rejectedPlans}` from an `explain` reply (find, aggregate or sharded).
pub fn plan_summary(reply: &Document) -> Value {
    let planner = reply
        .get_document("queryPlanner")
        .ok()
        .or_else(|| {
            reply.get_array("stages").ok()?.iter().find_map(|s| s.as_document()?.get_document("$cursor").ok()?.get_document("queryPlanner").ok())
        });
    let Some(p) = planner else {
        return json!({ "note": "the server returned no queryPlanner section" });
    };
    json!({
        "namespace": p.get_str("namespace").unwrap_or(""),
        "winningPlan": p.get("winningPlan").map(compact_plan).unwrap_or(Value::Null),
        "rejectedPlans": p.get_array("rejectedPlans").map(|a| a.len()).unwrap_or(0),
    })
}

/// Writes never run with an empty filter: "update/delete everything" is not something to do by chat.
fn non_empty_filter(args: &Value) -> Result<Document, String> {
    match doc_arg(args, "filter")? {
        Some(d) if !d.is_empty() => Ok(d),
        _ => Err("`filter` must be a non-empty object for writes".into()),
    }
}

/// The client MCP tools use. It is the NON-decrypting one: encrypted fields reach an AI assistant as
/// ciphertext (BinData subtype 6), never as plaintext, whatever the connection's own session shows.
pub(crate) async fn tool_client(state: &AppState, session_id: &str) -> Result<mongodb::Client, crate::error::AppError> {
    state.raw_client(session_id).await
}

#[cfg(test)]
mod tests {
    use mongodb::Client;
    #[tokio::test]
    async fn mcp_tools_read_through_the_non_decrypting_client() {
        let lazy = |db: &str| Client::with_uri_str(format!("mongodb://127.0.0.1:1/{db}"));
        let state = AppState::default();
        state.insert_session("s".into(), lazy("decrypting").await.unwrap(), false, String::new(), String::new(), None).await;
        state.sessions.lock().await.get_mut("s").unwrap().raw_client = Some(lazy("raw").await.unwrap());
        let c = tool_client(&state, "s").await.unwrap();
        assert_eq!(c.default_database().unwrap().name(), "raw", "MCP must not see plaintext of encrypted fields");
        // A session without encryption keeps using its own client.
        state.insert_session("p".into(), lazy("main").await.unwrap(), false, String::new(), String::new(), None).await;
        assert_eq!(tool_client(&state, "p").await.unwrap().default_database().unwrap().name(), "main");
    }

    use super::*;

    fn s(id: &str, label: &str) -> ExposedSession {
        ExposedSession { id: id.into(), label: label.into(), environment: String::new(), read_only: false, access: "write".into() }
    }

    #[test]
    fn write_tools_listed_only_when_allowed() {
        let names = |w| tool_list(w).iter().map(|t| t["name"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert!(!names(false).iter().any(|n| is_write_tool(n)));
        assert!(WRITE_TOOLS.iter().all(|w| names(true).iter().any(|n| n == w)));
        assert!(tool_list(false).iter().all(|t| t["annotations"]["readOnlyHint"] == true));
    }

    #[test]
    fn resolves_by_id_label_or_single() {
        let one = [s("a", "Local")];
        assert_eq!(resolve_session(&one, &json!({})).unwrap().id, "a");
        let two = [s("a", "Local"), s("b", "Staging")];
        assert_eq!(resolve_session(&two, &json!({ "connection": "staging" })).unwrap().id, "b");
        assert_eq!(resolve_session(&two, &json!({ "connection": "a" })).unwrap().id, "a");
        assert!(resolve_session(&two, &json!({})).unwrap_err().contains("Local, Staging"));
        assert!(resolve_session(&two, &json!({ "connection": "x" })).is_err());
        assert!(resolve_session(&[], &json!({})).is_err());
    }

    #[test]
    fn write_tool_refused_when_access_is_read() {
        let state = AppState::default();
        let ctx = ToolCtx { state: &state, sessions: &[], allow_writes: true, redact: &[], audit_reads: false };
        let mut sess = s("a", "A");
        let m = meta("dev", false);
        assert!(writes_refused(&ctx, &sess, Some(&m)).is_none());
        sess.access = "read".into();
        let why = writes_refused(&ctx, &sess, Some(&m)).unwrap();
        assert!(why.contains("MCP access"), "{why}");
        // a session JSON without the field (older frontend) deserializes as read-only access
        let parsed: ExposedSession = serde_json::from_value(json!({ "id": "x", "label": "X" })).unwrap();
        assert_eq!(parsed.access, "read");
        assert!(writes_refused(&ctx, &parsed, Some(&m)).is_some());
    }

    #[tokio::test]
    async fn write_tool_call_on_read_access_is_refused_and_audited() {
        let dir = std::env::temp_dir().join(format!("lumiong_mcp_access_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        state.audit.set_scope(crate::audit::AuditScope::All);
        state.insert_session("r1".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), false, "Dev".into(), "dev".into(), None).await;
        let mut sess = s("r1", "Dev");
        sess.access = "read".into();
        let sessions = [sess];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: true, redact: &[], audit_reads: false };
        let err = call_tool(&ctx, "delete_documents", &json!({ "database": "d", "collection": "c", "filter": { "a": 1 } })).await.unwrap_err();
        assert!(err.contains("MCP access"));
        assert_eq!(state.audit.query(0, i64::MAX, None).unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn explain_tool_is_read_only() {
        for allow in [false, true] {
            let list = tool_list(allow);
            let t = list.iter().find(|t| t["name"] == "explain").expect("explain is listed");
            assert_eq!(t["annotations"]["readOnlyHint"], true);
            assert_eq!(t["annotations"]["destructiveHint"], false);
        }
        assert!(!is_write_tool("explain"));
    }

    #[test]
    fn plan_summary_keeps_stages_and_indexes_only() {
        let reply = doc! {
            "queryPlanner": {
                "namespace": "shop.orders",
                "indexFilterSet": false,
                "winningPlan": {
                    "stage": "FETCH",
                    "filter": { "status": { "$eq": "paid" } },
                    "inputStage": { "stage": "IXSCAN", "keyPattern": { "status": 1 }, "indexName": "status_1", "direction": "forward", "indexBounds": { "status": ["[\"paid\", \"paid\"]"] } },
                },
                "rejectedPlans": [ {}, {} ],
            },
            "serverInfo": { "host": "secret-host" },
        };
        let v = plan_summary(&reply);
        assert_eq!(v["namespace"], "shop.orders");
        assert_eq!(v["rejectedPlans"], 2);
        assert_eq!(v["winningPlan"]["stage"], "FETCH");
        assert_eq!(v["winningPlan"]["inputStage"]["indexName"], "status_1");
        assert!(v["winningPlan"].get("filter").is_none());
        assert!(v["winningPlan"]["inputStage"].get("indexBounds").is_none());
        assert!(!v.to_string().contains("secret-host"));
        // aggregation replies nest the planner under the first $cursor stage
        let agg = doc! { "stages": [ { "$cursor": { "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "COLLSCAN", "direction": "forward" } } } } ] };
        assert_eq!(plan_summary(&agg)["winningPlan"]["stage"], "COLLSCAN");
        assert!(plan_summary(&doc! {}).get("note").is_some());
    }

    #[tokio::test]
    async fn queries_on_redacted_fields_are_refused() {
        let state = AppState::default();
        state.insert_session("a".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), false, "".into(), "".into(), None).await;
        let sessions = [s("a", "A")];
        let redact = vec!["password".to_string()];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &redact, audit_reads: false };
        for tool in ["find", "count_documents", "explain"] {
            let err = call_tool(&ctx, tool, &json!({ "database": "d", "collection": "c", "filter": { "password": { "$regex": "^a" } } })).await.unwrap_err();
            assert!(err.contains("redacted field"), "{tool}: {err}");
        }
        let err = call_tool(&ctx, "find", &json!({ "database": "d", "collection": "c", "sort": { "password": 1 } })).await.unwrap_err();
        assert!(err.contains("redacted field"));
    }

    #[tokio::test]
    async fn read_calls_are_audited_only_when_enabled() {
        let dir = std::env::temp_dir().join(format!("lumiong_mcp_reads_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        state.audit.set_scope(crate::audit::AuditScope::All);
        state.insert_session("a".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), false, "A".into(), "dev".into(), None).await;
        let sessions = [s("a", "A")];
        let redact = vec!["password".to_string()];
        let args = json!({ "database": "d", "collection": "c", "filter": { "password": 1 } });
        let off = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &redact, audit_reads: false };
        let _ = call_tool(&off, "find", &args).await;
        assert!(state.audit.query(0, i64::MAX, None).unwrap().is_empty());
        let on = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &redact, audit_reads: true };
        let _ = call_tool(&on, "find", &args).await;
        let lines = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!((lines[0].source.as_str(), lines[0].op.as_str()), ("mcp", "find"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn meta(environment: &str, read_only: bool) -> SessionMeta {
        SessionMeta { label: "A".into(), environment: environment.into(), read_only }
    }

    #[test]
    fn writes_refused_for_disabled_read_only_and_prod() {
        let state = AppState::default();
        let sess = s("a", "A");
        let off = ToolCtx { state: &state, sessions: &[], allow_writes: false, redact: &[], audit_reads: false };
        assert!(writes_refused(&off, &sess, Some(&meta("dev", false))).is_some());
        let on = ToolCtx { state: &state, sessions: &[], allow_writes: true, redact: &[], audit_reads: false };
        assert!(writes_refused(&on, &sess, Some(&meta("dev", false))).is_none());
        assert!(writes_refused(&on, &sess, Some(&meta("dev", true))).unwrap().contains("read-only"));
        assert!(writes_refused(&on, &sess, Some(&meta("prod", false))).unwrap().contains("production"));
    }

    #[test]
    fn writes_are_refused_without_rust_side_session_state() {
        let state = AppState::default();
        let on = ToolCtx { state: &state, sessions: &[], allow_writes: true, redact: &[], audit_reads: false };
        // the frontend list claims dev / writable, but Rust holds no record of the session
        assert!(writes_refused(&on, &s("a", "A"), None).unwrap().contains("no live session state"));
    }

    #[tokio::test]
    async fn environment_comes_from_rust_not_the_frontend_list() {
        let dir = std::env::temp_dir().join(format!("lumiong_mcp_trust_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        // Rust knows this connection is production and read-only...
        state.insert_session("t1".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), true, "Real".into(), "prod".into(), None).await;
        // ...but the frontend list says dev, writable, write access.
        let sessions = [s("t1", "Spoofed")];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: true, redact: &[], audit_reads: false };
        let err = call_tool(&ctx, "delete_documents", &json!({ "database": "d", "collection": "c", "filter": { "a": 1 } })).await.unwrap_err();
        assert!(err.contains("read-only") || err.contains("production"), "{err}");
        let lines = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!((lines[0].session_label.as_str(), lines[0].environment.as_str()), ("Real", "prod"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn aggregate_pipelines_cannot_reach_redacted_fields_and_out_is_audited_at_its_destination() {
        let dir = std::env::temp_dir().join(format!("lumiong_mcp_agg_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        state.audit.set_scope(crate::audit::AuditScope::All);
        state.insert_session("g1".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), false, "G".into(), "dev".into(), None).await;
        let sessions = [s("g1", "G")];
        let redact = vec!["*password*".to_string()];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &redact, audit_reads: false };
        for pipeline in [json!([{ "$match": { "userPassword": { "$regex": "^a" } } }]), json!([{ "$group": { "_id": "$password" } }])] {
            let err = call_tool(&ctx, "aggregate", &json!({ "database": "d", "collection": "c", "pipeline": pipeline })).await.unwrap_err();
            assert!(err.contains("redacted field"), "{err}");
        }
        // writes disabled: an $out pipeline is refused, and the attempt is audited against the destination
        let err = call_tool(&ctx, "aggregate", &json!({ "database": "d", "collection": "c", "pipeline": [{ "$out": { "db": "backup", "coll": "copy" } }] })).await.unwrap_err();
        assert!(err.contains("refused"));
        let lines = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!((lines[0].op.as_str(), lines[0].ns.as_str()), ("aggregate:$out", "backup.copy"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn args_accept_objects_or_json_strings_with_extjson() {
        let args = json!({ "filter": "{\"_id\": {\"$oid\": \"65a1b2c3d4e5f60718293a4b\"}}", "sort": { "n": -1 } });
        let f = doc_arg(&args, "filter").unwrap().unwrap();
        assert!(matches!(f.get("_id"), Some(Bson::ObjectId(_))));
        assert_eq!(doc_arg(&args, "sort").unwrap().unwrap(), doc! { "n": -1 });
        assert!(doc_arg(&json!({ "filter": [1] }), "filter").is_err());
        assert_eq!(doc_arg(&json!({}), "filter").unwrap(), None);
    }

    #[test]
    fn limits_are_clamped() {
        assert_eq!(int_arg(&json!({ "limit": 5000 }), "limit", 20, 1, 100).unwrap(), 100);
        assert_eq!(int_arg(&json!({ "limit": 0 }), "limit", 20, 1, 100).unwrap(), 1);
        assert_eq!(int_arg(&json!({}), "limit", 20, 1, 100).unwrap(), 20);
        assert!(int_arg(&json!({ "limit": "x" }), "limit", 20, 1, 100).is_err());
    }

    #[test]
    fn detects_writing_pipelines() {
        assert!(pipeline_writes(&[doc! { "$match": {} }, doc! { "$out": "x" }]));
        assert!(pipeline_writes(&[doc! { "$merge": { "into": "x" } }]));
        assert!(!pipeline_writes(&[doc! { "$match": {} }]));
    }

    #[test]
    fn write_filters_must_be_non_empty() {
        assert!(non_empty_filter(&json!({ "filter": {} })).is_err());
        assert!(non_empty_filter(&json!({})).is_err());
        assert!(non_empty_filter(&json!({ "filter": { "a": 1 } })).is_ok());
    }

    #[test]
    fn schema_summary_counts_types_and_presence() {
        let docs = vec![
            doc! { "a": 1, "b": { "c": "x" }, "tags": [{ "k": 1 }, { "k": 2 }] },
            doc! { "a": "s" },
        ];
        let v = schema_summary(&docs);
        assert_eq!(v["sampled"], 2);
        let field = |p: &str| v["fields"].as_array().unwrap().iter().find(|f| f["path"] == p).cloned().unwrap();
        assert_eq!(field("a")["types"], json!({ "int": 1, "string": 1 }));
        assert_eq!(field("a")["presence"], 1.0);
        assert_eq!(field("b.c")["presence"], 0.5);
        // two array elements carry `k`, but it is one document's worth of presence
        assert_eq!(field("tags.k")["types"], json!({ "int": 2 }));
        assert_eq!(field("tags.k")["presence"], 0.5);
    }

    #[test]
    fn render_truncates_large_output() {
        let big = Value::String("x".repeat(MAX_OUTPUT * 2));
        let out = render(&big);
        assert!(out.len() < MAX_OUTPUT + 200);
        assert!(out.contains("output truncated"));
    }

    #[test]
    fn relaxed_output_keeps_numbers_plain() {
        let v = relaxed(vec![doc! { "n": 5_i32, "d": 1.5 }]);
        assert_eq!(v, json!([{ "n": 5, "d": 1.5 }]));
    }

    #[tokio::test]
    async fn list_connections_needs_no_client_and_unknown_write_tools_are_refused() {
        let state = AppState::default();
        let sessions = [s("a", "Local")];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &[], audit_reads: false };
        let out = call_tool(&ctx, "list_connections", &json!({})).await.unwrap();
        assert!(out.contains("\"Local\""));
        assert!(call_tool(&ctx, "delete_documents", &json!({})).await.unwrap_err().contains("writes are disabled"));
        // a known session id that has no live client is reported, not panicked on
        assert!(call_tool(&ctx, "list_databases", &json!({})).await.is_err());
    }

    #[tokio::test]
    async fn refused_mcp_write_is_audited_once_with_redacted_filter() {
        let dir = std::env::temp_dir().join(format!("lumiong_mcp_audit_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = AppState::default();
        state.audit.set_dir(dir.clone());
        // A lazily-connecting client: the refusal happens before any network I/O.
        state.insert_session("p1".into(), mongodb::Client::with_uri_str("mongodb://localhost:1").await.unwrap(), false, "Shop".into(), "prod".into(), None).await;
        let mut sess = s("p1", "Shop");
        sess.environment = "prod".into();
        let sessions = [sess];
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: true, redact: &[], audit_reads: false };
        let args = json!({ "database": "shop", "collection": "orders", "filter": { "email": "a@b.c" }, "update": { "$set": { "x": 1 } } });
        let err = call_tool(&ctx, "update_documents", &args).await.unwrap_err();
        assert!(err.contains("production"));
        // reads are not audited by default
        let _ = call_tool(&ctx, "list_databases", &json!({})).await;
        let lines = state.audit.query(0, i64::MAX, None).unwrap();
        assert_eq!(lines.len(), 1);
        let e = &lines[0];
        assert_eq!((e.source.as_str(), e.op.as_str(), e.ns.as_str(), e.environment.as_str()), ("mcp", "update_documents", "shop.orders", "prod"));
        assert!(!e.ok);
        assert_eq!(e.filter_redacted.as_ref().unwrap()["email"], "<str:5>");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// End-to-end against a real server: `LUMIO_TEST_MONGO_URI=mongodb://localhost cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn tools_against_a_live_server() {
        let uri = std::env::var("LUMIO_TEST_MONGO_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let state = AppState::default();
        state.insert_session("s1".into(), mongodb::Client::with_uri_str(&uri).await.unwrap(), false, "".into(), "".into(), None).await;
        let sessions = [s("s1", "Local")];
        let db = "lumio_mcp_test";
        let ns = |extra: Value| {
            let mut v = json!({ "database": db, "collection": "people" });
            v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            v
        };
        let read = ToolCtx { state: &state, sessions: &sessions, allow_writes: false, redact: &[], audit_reads: false };
        let write = ToolCtx { state: &state, sessions: &sessions, allow_writes: true, redact: &[], audit_reads: false };
        let _ = state.client("s1").await.unwrap().database(db).drop().await;

        let docs = json!([{ "name": "Ann", "age": 31, "tags": ["a"] }, { "name": "Bo", "age": 25 }, { "name": "Cy", "age": 40, "born": { "$date": "1985-01-02T00:00:00Z" } }]);
        assert!(call_tool(&read, "insert_documents", &ns(json!({ "documents": docs }))).await.is_err());
        assert!(call_tool(&write, "insert_documents", &ns(json!({ "documents": docs }))).await.unwrap().contains("\"insertedCount\": 3"));

        let dbs = call_tool(&read, "list_databases", &json!({})).await.unwrap();
        assert!(dbs.contains(db));
        assert!(call_tool(&read, "list_collections", &json!({ "database": db })).await.unwrap().contains("people"));

        let found: Value = serde_json::from_str(&call_tool(&read, "find", &ns(json!({ "filter": { "age": { "$gt": 30 } }, "sort": { "age": 1 }, "projection": { "_id": 0, "name": 1 } }))).await.unwrap()).unwrap();
        assert_eq!(found, json!([{ "name": "Ann" }, { "name": "Cy" }]));

        let agg: Value = serde_json::from_str(&call_tool(&read, "aggregate", &ns(json!({ "pipeline": [{ "$group": { "_id": null, "n": { "$sum": 1 } } }] }))).await.unwrap()).unwrap();
        assert_eq!(agg[0]["n"], 3);
        assert!(call_tool(&read, "aggregate", &ns(json!({ "pipeline": [{ "$out": "copy" }] }))).await.unwrap_err().contains("refused"));

        assert!(call_tool(&read, "count_documents", &ns(json!({ "filter": { "age": { "$lt": 30 } } }))).await.unwrap().contains("\"count\": 1"));
        let schema: Value = serde_json::from_str(&call_tool(&read, "collection_schema", &ns(json!({})) ).await.unwrap()).unwrap();
        assert_eq!(schema["sampled"], 3);
        assert!(schema["fields"].as_array().unwrap().iter().any(|f| f["path"] == "born" && f["types"]["date"] == 1));
        assert!(call_tool(&read, "list_indexes", &ns(json!({}))).await.unwrap().contains("_id_"));

        assert!(call_tool(&write, "update_documents", &ns(json!({ "filter": {}, "update": { "$set": { "x": 1 } } }))).await.is_err());
        assert!(call_tool(&write, "update_documents", &ns(json!({ "filter": { "name": "Bo" }, "update": { "$set": { "age": 26 } } }))).await.unwrap().contains("\"modifiedCount\": 1"));
        assert!(call_tool(&write, "delete_documents", &ns(json!({ "filter": { "age": { "$gte": 26 } }, "many": true }))).await.unwrap().contains("\"deletedCount\": 3"));

        let _ = state.client("s1").await.unwrap().database(db).drop().await;
    }
}
