use crate::bson_json::doc_to_canonical_string;
use crate::error::AppError;
use crate::state::AppState;
use futures::stream::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::Client;
use tauri::State;

/// Runs a single-field `{ <cmd_name>: 1 }` admin command and serializes the reply.
async fn run_admin_command(client: &Client, cmd_name: &str) -> Result<String, AppError> {
    let resp = client.database("admin").run_command(doc! { cmd_name: 1 }).await?;
    doc_to_canonical_string(resp)
}

#[tauri::command]
pub async fn server_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "serverStatus").await
}

#[tauri::command]
pub async fn build_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "buildInfo").await
}

#[tauri::command]
pub async fn host_info(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "hostInfo").await
}

#[tauri::command]
pub async fn current_ops(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "currentOp").await
}

/// An operation id: a number on mongod, `"shard:1234"` on mongos.
#[derive(serde::Deserialize, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum OpId {
    Num(i64),
    Str(String),
}

impl From<OpId> for Bson {
    fn from(o: OpId) -> Bson {
        match o {
            OpId::Num(n) => Bson::Int64(n),
            OpId::Str(s) => Bson::String(s),
        }
    }
}

#[tauri::command]
pub async fn kill_op(
    session_id: String,
    opid: OpId,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let client = state.writable_client(&session_id).await?;
    client
        .database("admin")
        .run_command(doc! { "killOp": 1, "op": Bson::from(opid) })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn is_master(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "isMaster").await
}

#[tauri::command]
pub async fn repl_set_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "replSetGetStatus").await
}

#[tauri::command]
pub async fn list_shards(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "listShards").await
}

#[tauri::command]
pub async fn balancer_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    run_admin_command(&client, "balancerStatus").await
}

/// `serverStatus` minus its heavy sections — the dashboard polls this every few seconds.
fn metrics_command() -> Document {
    doc! {
        "serverStatus": 1,
        "repl": 0, "metrics": 0, "locks": 0, "wiredTiger": 0, "tcmalloc": 0,
        "globalLock": 0, "asserts": 0, "transactions": 0, "security": 0,
    }
}

/// Keeps only the fields the Overview dashboard reads (a few KB instead of the full reply).
fn metrics_subset(full: &Document) -> Document {
    const KEEP: [&str; 8] = [
        "host", "version", "uptime", "localTime", "opcounters", "connections", "network", "mem",
    ];
    let mut out = Document::new();
    for k in KEEP {
        if let Some(v) = full.get(k) {
            out.insert(k, v.clone());
        }
    }
    out
}

/// `$currentOp` filtered and projected on the server: active ops running at least `threshold_secs`,
/// minus the long-lived tailable getMores (oplog readers of secondaries, change streams) that are
/// slow by design — and only the fields the dashboard shows.
fn slow_ops_pipeline(threshold_secs: i64) -> Vec<Document> {
    vec![
        doc! { "$currentOp": { "allUsers": true, "idleConnections": false } },
        doc! { "$match": {
            "active": true,
            "secs_running": { "$gte": threshold_secs },
            "ns": { "$ne": "local.oplog.rs" },
            "cursor.tailable": { "$ne": true },
        } },
        doc! { "$project": { "_id": 0, "opid": 1, "op": 1, "ns": 1, "secs_running": 1, "client": 1, "client_s": 1, "appName": 1 } },
    ]
}

#[tauri::command]
pub async fn server_metrics(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let full = client.database("admin").run_command(metrics_command()).await?;
    doc_to_canonical_string(metrics_subset(&full))
}

#[tauri::command]
pub async fn slow_ops(
    session_id: String,
    threshold_secs: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let mut cursor = client
        .database("admin")
        .aggregate(slow_ops_pipeline(threshold_secs.max(0)))
        .await?;
    let mut out = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        out.push(doc_to_canonical_string(d)?);
    }
    Ok(out)
}

/// `[{db, level, slowms}]` for every user database; databases that refuse `profile` are skipped.
#[tauri::command]
pub async fn profiler_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let names = client.list_database_names().await?;
    let mut rows = Vec::new();
    for name in names.into_iter().filter(|n| n != "local" && n != "config") {
        if let Ok(r) = client.database(&name).run_command(doc! { "profile": -1 }).await {
            let mut row = Document::new();
            row.insert("db", name);
            row.insert("level", r.get("was").cloned().unwrap_or(Bson::Int32(0)));
            row.insert("slowms", r.get("slowms").cloned().unwrap_or(Bson::Null));
            rows.push(Bson::Document(row));
        }
    }
    crate::bson_json::bson_to_canonical_string(&Bson::Array(rows))
}

/// Newest `system.profile` entries of one database (only called when its profiler is on).
#[tauri::command]
pub async fn recent_slow_queries(
    session_id: String,
    db: String,
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let client = state.client(&session_id).await?;
    let mut cursor = client
        .database(&db)
        .collection::<Document>("system.profile")
        .find(doc! {})
        .projection(doc! { "_id": 0, "ts": 1, "op": 1, "ns": 1, "millis": 1, "planSummary": 1 })
        .sort(doc! { "ts": -1 })
        .limit(limit.clamp(1, 20))
        .await?;
    let mut out = Vec::new();
    while let Some(d) = cursor.try_next().await? {
        out.push(doc_to_canonical_string(d)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_subset_keeps_only_dashboard_fields() {
        let full = doc! {
            "host": "h", "version": "8.0.4", "uptime": 10, "localTime": 1,
            "opcounters": { "query": 1 }, "connections": { "current": 2 },
            "network": { "bytesIn": 3 }, "mem": { "resident": 4 },
            "wiredTiger": { "x": 1 }, "locks": {}, "metrics": {},
        };
        let out = metrics_subset(&full);
        let keys: Vec<&str> = out.keys().map(|k| k.as_str()).collect();
        assert_eq!(
            keys,
            ["host", "version", "uptime", "localTime", "opcounters", "connections", "network", "mem"]
        );
    }

    #[test]
    fn metrics_command_excludes_heavy_sections() {
        let c = metrics_command();
        for k in ["repl", "metrics", "locks", "wiredTiger", "tcmalloc", "globalLock", "asserts", "transactions", "security"] {
            assert_eq!(c.get_i32(k).unwrap(), 0, "{k}");
        }
        assert_eq!(c.keys().next().unwrap(), "serverStatus");
    }

    #[test]
    fn slow_ops_pipeline_filters_and_projects_on_server() {
        let p = slow_ops_pipeline(5);
        assert_eq!(p.len(), 3);
        let m = p[1].get_document("$match").unwrap();
        assert_eq!(m.get_document("secs_running").unwrap(), &doc! { "$gte": 5i64 });
        assert_eq!(m.get_document("ns").unwrap(), &doc! { "$ne": "local.oplog.rs" });
        assert_eq!(m.get_document("cursor.tailable").unwrap(), &doc! { "$ne": true });
        let proj = p[2].get_document("$project").unwrap();
        assert!(proj.contains_key("opid") && proj.contains_key("appName") && !proj.contains_key("command"));
    }

    #[test]
    fn opid_accepts_numbers_and_mongos_strings() {
        assert_eq!(serde_json::from_str::<OpId>("4411").unwrap(), OpId::Num(4411));
        assert_eq!(serde_json::from_str::<OpId>(r#""shard01:1234""#).unwrap(), OpId::Str("shard01:1234".into()));
        assert_eq!(Bson::from(OpId::Str("s:1".into())), Bson::String("s:1".into()));
    }
}
