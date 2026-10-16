use crate::bson_json::{doc_to_raw, RawDoc};
use crate::error::AppError;
use crate::json_bson::canonical_string_to_doc_array;
use crate::state::AppState;
use futures::StreamExt;
use mongodb::bson::{doc, Document};
use mongodb::options::{ChangeStreamOptions, FullDocumentBeforeChangeType, FullDocumentType};
use mongodb::change_stream::ChangeStream;
use mongodb::Client;
use serde::Serialize;
use std::time::Duration;
use tauri::{ipc::Channel, State};
use tokio::sync::oneshot;
use tokio::time::Instant;

/// Events are sent in small batches so a burst of writes doesn't cost one IPC message each.
pub(crate) const BATCH_MAX: usize = 256;
pub(crate) const BATCH_WINDOW: Duration = Duration::from_millis(80);
/// Pre-images (`fullDocumentBeforeChange`) exist from MongoDB 6.0 (wire version 17).
const PRE_IMAGE_WIRE_VERSION: i64 = 17;

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WatchMessage {
    /// Change events as Canonical Extended JSON, oldest first, with each one's serialized length
    /// (the frontend bounds its memory by it).
    Events { events: Vec<RawDoc>, sizes: Vec<usize> },
    /// The stream failed after it opened; it is closed.
    Error { message: String },
    /// The server closed the stream (e.g. the watched collection was dropped).
    Ended,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WatchStart {
    #[serde(rename_all = "camelCase")]
    Started { pre_images: bool },
    /// Change streams need a replica set or sharded cluster.
    Standalone,
}

#[derive(Debug, PartialEq)]
pub(crate) struct Support {
    pub(crate) supported: bool,
    pub(crate) pre_images: bool,
}

/// Reads the `hello` reply: change streams need a replica set member or a mongos.
pub(crate) fn support_from_hello(hello: &Document) -> Support {
    let supported = hello.get_str("setName").is_ok() || hello.get_str("msg") == Ok("isdbgrid");
    let wire = hello
        .get_i32("maxWireVersion")
        .map(i64::from)
        .or_else(|_| hello.get_i64("maxWireVersion"))
        .unwrap_or(0);
    Support { supported, pre_images: supported && wire >= PRE_IMAGE_WIRE_VERSION }
}

async fn open_stream(
    client: &Client,
    db: Option<&str>,
    coll: Option<&str>,
    pipeline: Vec<Document>,
    pre_images: bool,
) -> Result<ChangeStream<Document>, AppError> {
    let options = ChangeStreamOptions::builder()
        .full_document(Some(FullDocumentType::UpdateLookup))
        .full_document_before_change(pre_images.then_some(FullDocumentBeforeChangeType::WhenAvailable))
        .build();
    let stream = match (db, coll) {
        (Some(db), Some(coll)) => {
            client
                .database(db)
                .collection::<Document>(coll)
                .watch()
                .pipeline(pipeline)
                .with_options(options)
                .await?
                .with_type::<Document>()
        }
        (Some(db), None) => {
            client
                .database(db)
                .watch()
                .pipeline(pipeline)
                .with_options(options)
                .await?
                .with_type::<Document>()
        }
        _ => {
            client
                .watch()
                .pipeline(pipeline)
                .with_options(options)
                .await?
                .with_type::<Document>()
        }
    };
    Ok(stream)
}

pub(crate) fn flush(buf: &mut Vec<RawDoc>, on_event: &Channel<WatchMessage>) {
    if !buf.is_empty() {
        let events = std::mem::take(buf);
        let sizes = events.iter().map(|e| e.get().len()).collect();
        let _ = on_event.send(WatchMessage::Events { events, sizes });
    }
}

/// Forwards events until `stop` fires (or its sender is dropped), the stream errors, or it ends.
async fn pump(mut stream: ChangeStream<Document>, mut stop: oneshot::Receiver<()>, on_event: Channel<WatchMessage>) {
    let mut buf: Vec<RawDoc> = Vec::new();
    let mut flush_at = Instant::now();
    loop {
        tokio::select! {
            _ = &mut stop => break,
            _ = tokio::time::sleep_until(flush_at), if !buf.is_empty() => flush(&mut buf, &on_event),
            item = stream.next() => match item {
                Some(Ok(event)) => match doc_to_raw(event) {
                    Ok(raw) => {
                        if buf.is_empty() {
                            flush_at = Instant::now() + BATCH_WINDOW;
                        }
                        buf.push(raw);
                        if buf.len() >= BATCH_MAX {
                            flush(&mut buf, &on_event);
                        }
                    }
                    Err(e) => {
                        flush(&mut buf, &on_event);
                        let _ = on_event.send(WatchMessage::Error { message: e.to_string() });
                        break;
                    }
                },
                Some(Err(e)) => {
                    flush(&mut buf, &on_event);
                    let _ = on_event.send(WatchMessage::Error { message: AppError::from(e).to_string() });
                    break;
                }
                None => {
                    flush(&mut buf, &on_event);
                    let _ = on_event.send(WatchMessage::Ended);
                    break;
                }
            },
        }
    }
}

/// Opens a change stream on a collection, a database (`coll` omitted) or the whole deployment (both
/// omitted) and streams its events to `on_event` until `watch_stop` or the session closes.
/// `pipeline` is an optional Extended JSON array of stages applied to the events.
#[tauri::command]
pub async fn watch_start(
    session_id: String,
    watch_id: String,
    db: Option<String>,
    coll: Option<String>,
    pipeline: Option<String>,
    on_event: Channel<WatchMessage>,
    state: State<'_, AppState>,
) -> Result<WatchStart, AppError> {
    let client = state.client(&session_id).await?;
    let hello = client.database("admin").run_command(doc! { "hello": 1 }).await?;
    let support = support_from_hello(&hello);
    if !support.supported {
        return Ok(WatchStart::Standalone);
    }
    let stages = match pipeline.as_deref().map(str::trim) {
        Some(p) if !p.is_empty() => {
            canonical_string_to_doc_array(p, "watch pipeline must be an array", "each stage must be a document")?
        }
        _ => Vec::new(),
    };
    let stream = open_stream(&client, db.as_deref(), coll.as_deref(), stages, support.pre_images).await?;

    let (tx, rx) = oneshot::channel();
    // Replacing an entry drops its sender, which stops a stream left under the same id.
    state.watches.lock().await.insert((session_id, watch_id), tx);
    tauri::async_runtime::spawn(pump(stream, rx, on_event));
    Ok(WatchStart::Started { pre_images: support.pre_images })
}

#[tauri::command]
pub async fn watch_stop(session_id: String, watch_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut watches = state.watches.lock().await;
    watches.remove(&(session_id, watch_id));
    // Also forget streams that already ended on their own (their receiver is gone).
    watches.retain(|_, tx| !tx.is_closed());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standalone_is_unsupported() {
        let s = support_from_hello(&doc! { "isWritablePrimary": true, "maxWireVersion": 21 });
        assert_eq!(s, Support { supported: false, pre_images: false });
    }

    #[test]
    fn replica_set_member_is_supported_with_pre_images_from_6_0() {
        assert_eq!(
            support_from_hello(&doc! { "setName": "rs0", "maxWireVersion": 17 }),
            Support { supported: true, pre_images: true }
        );
        assert_eq!(
            support_from_hello(&doc! { "setName": "rs0", "maxWireVersion": 8 }),
            Support { supported: true, pre_images: false }
        );
    }

    #[test]
    fn mongos_is_supported() {
        let s = support_from_hello(&doc! { "msg": "isdbgrid", "maxWireVersion": 21i64 });
        assert_eq!(s, Support { supported: true, pre_images: true });
    }

    #[test]
    fn start_result_serializes_for_the_frontend() {
        let json = serde_json::to_string(&WatchStart::Started { pre_images: true }).unwrap();
        assert_eq!(json, r#"{"status":"started","preImages":true}"#);
        assert_eq!(serde_json::to_string(&WatchStart::Standalone).unwrap(), r#"{"status":"standalone"}"#);
    }
}
