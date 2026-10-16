use crate::bson_json::{doc_to_raw, RawDoc};
use crate::commands::watch::{flush, WatchMessage, BATCH_MAX, BATCH_WINDOW};
use crate::error::AppError;
use crate::state::AppState;
use futures::StreamExt;
use mongodb::bson::{doc, Bson, DateTime, Document};
use mongodb::error::ErrorKind;
use mongodb::options::CursorType;
use mongodb::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{ipc::Channel, State};
use tokio::sync::{oneshot, Mutex};
use tokio::time::Instant;

/// How long to wait before reopening the tail when `system.profile` is missing or empty (a tailable
/// cursor on an empty capped collection closes at once).
const RETRY_EVERY: Duration = Duration::from_millis(700);

#[derive(Clone, Copy, Debug, PartialEq)]
struct ProfileSetting {
    level: i32,
    slowms: i64,
}

#[derive(Debug)]
struct Hold {
    count: u32,
    original: ProfileSetting,
    applied: ProfileSetting,
}

/// Profiler settings the app changed, per (session, database), with how many Watch tabs rely on
/// them. The original setting is put back when the last of them stops.
#[derive(Default, Clone)]
pub struct ProfilerHolds(Arc<Mutex<HashMap<(String, String), Hold>>>);

fn setting_from_reply(r: &Document) -> ProfileSetting {
    let num = |k: &str| match r.get(k) {
        Some(Bson::Int32(n)) => Some(i64::from(*n)),
        Some(Bson::Int64(n)) => Some(*n),
        Some(Bson::Double(n)) => Some(*n as i64),
        _ => None,
    };
    ProfileSetting { level: num("was").unwrap_or(0) as i32, slowms: num("slowms").unwrap_or(100) }
}

async fn run_profile(client: &Client, db: &str, s: ProfileSetting) -> Result<ProfileSetting, mongodb::error::Error> {
    let reply = client.database(db).run_command(doc! { "profile": s.level, "slowms": s.slowms }).await?;
    Ok(setting_from_reply(&reply))
}

impl ProfilerHolds {
    /// Applies `wanted`, remembering the setting found before the first hold on this database.
    async fn acquire(&self, client: &Client, session: &str, db: &str, wanted: ProfileSetting) -> Result<(), mongodb::error::Error> {
        let mut holds = self.0.lock().await;
        let key = (session.to_string(), db.to_string());
        if let Some(h) = holds.get_mut(&key) {
            // Another tab already watches this database: record whatever either of them wants.
            let merged = ProfileSetting { level: h.applied.level.max(wanted.level), slowms: h.applied.slowms.min(wanted.slowms) };
            if merged != h.applied {
                run_profile(client, db, merged).await?;
                h.applied = merged;
            }
            h.count += 1;
            return Ok(());
        }
        // `profile` replies with the setting it replaced.
        let original = run_profile(client, db, wanted).await?;
        holds.insert(key, Hold { count: 1, original, applied: wanted });
        Ok(())
    }

    /// Drops one hold; the last one restores the original setting.
    async fn release(&self, client: &Client, session: &str, db: &str) {
        let mut holds = self.0.lock().await;
        let key = (session.to_string(), db.to_string());
        let Some(h) = holds.get_mut(&key) else { return };
        h.count = h.count.saturating_sub(1);
        if h.count == 0 {
            let original = h.original;
            holds.remove(&key);
            let _ = run_profile(client, db, original).await;
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProfileStart {
    #[serde(rename_all = "camelCase")]
    Started { previous_level: i32 },
    /// A mongos has no profiler of its own; it lives on each shard.
    Mongos,
    /// Turning the profiler on changes server settings, which a read-only connection never does.
    ReadOnly,
    /// The user may not run `profile` on this database.
    Denied { message: String },
    /// The server doesn't offer the profiler (e.g. Atlas shared tiers, serverless).
    Unsupported { message: String },
}

/// Sorts a failed `profile` command into the cases the UI explains; anything else is a plain error.
fn classify_profile_error(e: mongodb::error::Error) -> Result<ProfileStart, AppError> {
    if let ErrorKind::Command(c) = e.kind.as_ref() {
        let message = format!("{} (code {}): {}", c.code_name, c.code, c.message);
        return match c.code {
            13 => Ok(ProfileStart::Denied { message }),
            // CommandNotFound, CommandNotSupported, AtlasError, IllegalOperation
            59 | 115 | 8000 | 20 => Ok(ProfileStart::Unsupported { message }),
            _ => Err(AppError::from(e)),
        };
    }
    Err(AppError::from(e))
}

/// Profile entries worth showing: not the tail itself or `profile` calls. With `coll`, only that
/// collection. (Change-stream polling is dropped by `is_change_stream`: a query can't name a
/// `$`-prefixed field.)
fn tail_filter(db: &str, coll: Option<&str>, after: DateTime) -> Document {
    let mut f = doc! {
        "ts": { "$gt": after },
        "command.profile": { "$exists": false },
    };
    match coll {
        Some(c) => f.insert("ns", format!("{db}.{c}")),
        None => f.insert("ns", doc! { "$ne": format!("{db}.system.profile") }),
    };
    f
}

/// A change stream's aggregate or getMore — the Watch tab's own polling, not the user's queries.
fn is_change_stream(entry: &Document) -> bool {
    let first_stage_is_stream = |key: &str| {
        entry
            .get_document(key)
            .ok()
            .and_then(|c| c.get_array("pipeline").ok())
            .and_then(|p| p.first())
            .and_then(Bson::as_document)
            .is_some_and(|stage| stage.contains_key("$changeStream"))
    };
    first_stage_is_stream("command") || first_stage_is_stream("originatingCommand")
}

/// Bulky diagnostics nobody reads; the rest of the entry is kept.
fn tail_projection() -> Document {
    doc! { "locks": 0, "flowControl": 0, "storage": 0 }
}

/// Drops the session/cluster-time plumbing drivers add to every command (a projection can't name
/// `$`-prefixed fields).
fn trim_entry(entry: &mut Document) {
    for key in ["command", "originatingCommand"] {
        if let Ok(c) = entry.get_document_mut(key) {
            c.remove("lsid");
            c.remove("$clusterTime");
        }
    }
}

enum TailEnd {
    Stopped,
    Failed(String),
}

/// Follows `system.profile` with a tailable cursor, reopening it whenever it closes (the collection
/// may not exist yet, or be empty), until `stop` fires or reading fails.
async fn tail(
    client: &Client,
    db: &str,
    coll: Option<&str>,
    mut after: DateTime,
    stop: &mut oneshot::Receiver<()>,
    on_event: &Channel<WatchMessage>,
) -> TailEnd {
    let profile = client.database(db).collection::<Document>("system.profile");
    let mut buf: Vec<RawDoc> = Vec::new();
    let mut flush_at = Instant::now();
    loop {
        let opened = profile
            .find(tail_filter(db, coll, after))
            .projection(tail_projection())
            .cursor_type(CursorType::TailableAwait)
            .max_await_time(Duration::from_secs(1))
            .await;
        let mut cursor = match opened {
            Ok(c) => Some(c),
            Err(e) => match e.kind.as_ref() {
                // Not created yet: the profiler writes its first entry soon.
                ErrorKind::Command(c) if c.code == 26 => None,
                _ => return TailEnd::Failed(AppError::from(e).to_string()),
            },
        };
        while let Some(cur) = cursor.as_mut() {
            tokio::select! {
                _ = &mut *stop => {
                    flush(&mut buf, on_event);
                    return TailEnd::Stopped;
                }
                _ = tokio::time::sleep_until(flush_at), if !buf.is_empty() => flush(&mut buf, on_event),
                item = cur.next() => match item {
                    Some(Ok(entry)) => {
                        if let Ok(ts) = entry.get_datetime("ts") {
                            after = after.max(*ts);
                        }
                        if is_change_stream(&entry) {
                            continue;
                        }
                        let mut entry = entry;
                        trim_entry(&mut entry);
                        if let Ok(raw) = doc_to_raw(entry) {
                            if buf.is_empty() {
                                flush_at = Instant::now() + BATCH_WINDOW;
                            }
                            buf.push(raw);
                            if buf.len() >= BATCH_MAX {
                                flush(&mut buf, on_event);
                            }
                        }
                    }
                    Some(Err(e)) => match e.kind.as_ref() {
                        // The capped collection wrapped past our position, or was dropped: reopen.
                        ErrorKind::Command(c) if matches!(c.code, 26 | 136 | 175 | 237) => break,
                        _ => {
                            flush(&mut buf, on_event);
                            return TailEnd::Failed(AppError::from(e).to_string());
                        }
                    },
                    None => break,
                },
            }
        }
        flush(&mut buf, on_event);
        tokio::select! {
            _ = &mut *stop => return TailEnd::Stopped,
            _ = tokio::time::sleep(RETRY_EVERY) => {}
        }
    }
}

/// Turns the database profiler on (`level` 2 = every operation, 1 = slower than `slowms`) and streams
/// new `system.profile` entries to `on_event` until `watch_stop` or the session closes; the previous
/// profiler setting is then put back. Cases the user must be told about come back as a status.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn profile_watch_start(
    session_id: String,
    watch_id: String,
    db: String,
    coll: Option<String>,
    level: i32,
    slowms: i64,
    on_event: Channel<WatchMessage>,
    state: State<'_, AppState>,
) -> Result<ProfileStart, AppError> {
    let client = state.client(&session_id).await?;
    if state.read_only(&session_id).await? {
        return Ok(ProfileStart::ReadOnly);
    }
    let hello = client.database("admin").run_command(doc! { "hello": 1 }).await?;
    if hello.get_str("msg") == Ok("isdbgrid") {
        return Ok(ProfileStart::Mongos);
    }
    // Entries are matched against the server's clock, not ours.
    let since = hello.get_datetime("localTime").copied().unwrap_or_else(|_| DateTime::now());

    let previous = match client.database(&db).run_command(doc! { "profile": -1 }).await {
        Ok(r) => setting_from_reply(&r),
        Err(e) => return classify_profile_error(e),
    };
    let holds = state.profiler_holds.clone();
    let wanted = ProfileSetting { level: level.clamp(1, 2), slowms: slowms.max(0) };
    if let Err(e) = holds.acquire(&client, &session_id, &db, wanted).await {
        return classify_profile_error(e);
    }

    let (tx, mut rx) = oneshot::channel();
    state.watches.lock().await.insert((session_id.clone(), watch_id), tx);
    tauri::async_runtime::spawn(async move {
        let end = tail(&client, &db, coll.as_deref(), since, &mut rx, &on_event).await;
        holds.release(&client, &session_id, &db).await;
        if let TailEnd::Failed(message) = end {
            let _ = on_event.send(WatchMessage::Error { message });
        }
    });
    Ok(ProfileStart::Started { previous_level: previous.level })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_setting_a_profile_reply_reports() {
        assert_eq!(setting_from_reply(&doc! { "was": 2, "slowms": 50i64 }), ProfileSetting { level: 2, slowms: 50 });
        assert_eq!(setting_from_reply(&doc! { "was": 0.0, "ok": 1 }), ProfileSetting { level: 0, slowms: 100 });
    }

    #[test]
    fn tail_filter_skips_the_apps_own_noise_and_scopes_to_a_collection() {
        let after = DateTime::from_millis(5);
        let f = tail_filter("app", Some("orders"), after);
        assert_eq!(f.get_str("ns").unwrap(), "app.orders");
        assert!(f.contains_key("command.profile"));
        let f = tail_filter("app", None, after);
        assert_eq!(f.get_document("ns").unwrap(), &doc! { "$ne": "app.system.profile" });
    }

    #[test]
    fn recognizes_change_stream_polling() {
        let agg = doc! { "op": "command", "command": { "aggregate": "c", "pipeline": [{ "$changeStream": {} }] } };
        let more = doc! { "op": "getmore", "originatingCommand": { "aggregate": "c", "pipeline": [{ "$changeStream": {} }] } };
        let user = doc! { "op": "command", "command": { "aggregate": "c", "pipeline": [{ "$match": {} }] } };
        assert!(is_change_stream(&agg));
        assert!(is_change_stream(&more));
        assert!(!is_change_stream(&user));
        assert!(!is_change_stream(&doc! { "op": "query", "command": { "find": "c" } }));
    }

    #[test]
    fn trims_driver_plumbing_from_commands() {
        let mut e = doc! { "command": { "find": "c", "lsid": { "id": 1 }, "$clusterTime": {}, "$db": "app" } };
        trim_entry(&mut e);
        assert_eq!(e, doc! { "command": { "find": "c", "$db": "app" } });
    }

    #[test]
    fn start_statuses_serialize_for_the_frontend() {
        let s = |v: &ProfileStart| serde_json::to_string(v).unwrap();
        assert_eq!(s(&ProfileStart::Started { previous_level: 0 }), r#"{"status":"started","previousLevel":0}"#);
        assert_eq!(s(&ProfileStart::Mongos), r#"{"status":"mongos"}"#);
        assert_eq!(s(&ProfileStart::ReadOnly), r#"{"status":"readOnly"}"#);
        assert_eq!(s(&ProfileStart::Denied { message: "x".into() }), r#"{"status":"denied","message":"x"}"#);
    }
}
