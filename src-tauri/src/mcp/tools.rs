//! The MCP tool surface: what an AI client may do with the connections the user exposed. Read tools
//! are always on; write tools exist only while "Allow writes" is on, and even then never touch a
//! read-only or production-labelled connection. Results are Relaxed Extended JSON text — friendlier
//! for a model to read than the canonical form the app's own frontend uses.

use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{AggregateOptions, FindOptions};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
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
}

pub struct ToolCtx<'a> {
    pub state: &'a AppState,
    pub sessions: &'a [ExposedSession],
    pub allow_writes: bool,
}

const DEFAULT_LIMIT: i64 = 20;
const MAX_LIMIT: i64 = 100;
const DEFAULT_SAMPLE: i64 = 100;
const MAX_SAMPLE: i64 = 1000;
const MAX_INSERT: usize = 1000;
const OP_TIMEOUT: Duration = Duration::from_secs(30);
/// Tool output cap: a model's context is the real limit, and a runaway result helps nobody.
const MAX_OUTPUT: usize = 200 * 1024;

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

fn writes_refused(ctx: &ToolCtx<'_>, s: &ExposedSession) -> Option<String> {
    if !ctx.allow_writes {
        Some("writes are disabled in LumioNG's MCP settings".into())
    } else if s.read_only {
        Some(format!("connection `{}` is read-only", s.label))
    } else if s.environment == "prod" {
        Some(format!("connection `{}` is labelled production; MCP never writes to it", s.label))
    } else {
        None
    }
}

fn pipeline_writes(stages: &[Document]) -> bool {
    stages.iter().any(|s| s.contains_key("$out") || s.contains_key("$merge"))
}

// ── output helpers ──

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
            .map(|s| json!({ "id": s.id, "label": s.label, "environment": s.environment, "readOnly": s.read_only }))
            .collect();
        return Ok(render(&Value::Array(list)));
    }
    if is_write_tool(name) && !ctx.allow_writes {
        return Err(format!("unknown tool `{name}` (writes are disabled)"));
    }
    let session = resolve_session(ctx.sessions, args)?;
    let client = ctx.state.client(&session.id).await.map_err(|e| e.to_string())?;
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
                let limit = int_arg(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)?;
                let skip = int_arg(args, "skip", 0, 0, i64::MAX)?;
                let opts = FindOptions::builder()
                    .projection(doc_arg(args, "projection")?)
                    .sort(doc_arg(args, "sort")?)
                    .limit(limit)
                    .skip(skip as u64)
                    .max_time(OP_TIMEOUT)
                    .build();
                let docs: Vec<Document> = coll.find(filter).with_options(opts).await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
                Ok(render(&relaxed(docs)))
            }
            "aggregate" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let mut stages = doc_array_arg(args, "pipeline")?;
                if pipeline_writes(&stages) {
                    if let Some(why) = writes_refused(ctx, session) {
                        return Err(format!("$out/$merge refused: {why}"));
                    }
                } else {
                    stages.push(doc! { "$limit": int_arg(args, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT)? });
                }
                let opts = AggregateOptions::builder().max_time(OP_TIMEOUT).build();
                let docs: Vec<Document> = coll.aggregate(stages).with_options(opts).await.map_err(|e| e.to_string())?.try_collect().await.map_err(|e| e.to_string())?;
                Ok(render(&relaxed(docs)))
            }
            "count_documents" => {
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let n = coll.count_documents(doc_arg(args, "filter")?.unwrap_or_default()).max_time(OP_TIMEOUT).await.map_err(|e| e.to_string())?;
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
            "insert_documents" => {
                if let Some(why) = writes_refused(ctx, session) {
                    return Err(why);
                }
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let docs = doc_array_arg(args, "documents")?;
                if docs.is_empty() || docs.len() > MAX_INSERT {
                    return Err(format!("`documents` must hold 1 to {MAX_INSERT} documents"));
                }
                let res = coll.insert_many(docs).await.map_err(|e| e.to_string())?;
                Ok(render(&json!({ "insertedCount": res.inserted_ids.len() })))
            }
            "update_documents" => {
                if let Some(why) = writes_refused(ctx, session) {
                    return Err(why);
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
                    .map_err(|e| e.to_string())?;
                Ok(render(&json!({ "matchedCount": res.matched_count, "modifiedCount": res.modified_count })))
            }
            "delete_documents" => {
                if let Some(why) = writes_refused(ctx, session) {
                    return Err(why);
                }
                let coll = client.database(str_arg(args, "database")?).collection::<Document>(str_arg(args, "collection")?);
                let filter = non_empty_filter(args)?;
                let res = if bool_arg(args, "many") { coll.delete_many(filter).await } else { coll.delete_one(filter).await }.map_err(|e| e.to_string())?;
                Ok(render(&json!({ "deletedCount": res.deleted_count })))
            }
            other => Err(format!("unknown tool `{other}`")),
        }
    };
    run.await
}

/// Writes never run with an empty filter: "update/delete everything" is not something to do by chat.
fn non_empty_filter(args: &Value) -> Result<Document, String> {
    match doc_arg(args, "filter")? {
        Some(d) if !d.is_empty() => Ok(d),
        _ => Err("`filter` must be a non-empty object for writes".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, label: &str) -> ExposedSession {
        ExposedSession { id: id.into(), label: label.into(), environment: String::new(), read_only: false }
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
    fn writes_refused_for_disabled_read_only_and_prod() {
        let state = AppState::default();
        let mut sess = s("a", "A");
        let off = ToolCtx { state: &state, sessions: &[], allow_writes: false };
        assert!(writes_refused(&off, &sess).is_some());
        let on = ToolCtx { state: &state, sessions: &[], allow_writes: true };
        assert!(writes_refused(&on, &sess).is_none());
        sess.read_only = true;
        assert!(writes_refused(&on, &sess).unwrap().contains("read-only"));
        sess.read_only = false;
        sess.environment = "prod".into();
        assert!(writes_refused(&on, &sess).unwrap().contains("production"));
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
        let ctx = ToolCtx { state: &state, sessions: &sessions, allow_writes: false };
        let out = call_tool(&ctx, "list_connections", &json!({})).await.unwrap();
        assert!(out.contains("\"Local\""));
        assert!(call_tool(&ctx, "delete_documents", &json!({})).await.unwrap_err().contains("writes are disabled"));
        // a known session id that has no live client is reported, not panicked on
        assert!(call_tool(&ctx, "list_databases", &json!({})).await.is_err());
    }

    /// End-to-end against a real server: `LUMIO_TEST_MONGO_URI=mongodb://localhost cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn tools_against_a_live_server() {
        let uri = std::env::var("LUMIO_TEST_MONGO_URI").unwrap_or_else(|_| "mongodb://localhost:27017".into());
        let state = AppState::default();
        state.insert_session("s1".into(), mongodb::Client::with_uri_str(&uri).await.unwrap(), false, None).await;
        let sessions = [s("s1", "Local")];
        let db = "lumio_mcp_test";
        let ns = |extra: Value| {
            let mut v = json!({ "database": db, "collection": "people" });
            v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            v
        };
        let read = ToolCtx { state: &state, sessions: &sessions, allow_writes: false };
        let write = ToolCtx { state: &state, sessions: &sessions, allow_writes: true };
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
