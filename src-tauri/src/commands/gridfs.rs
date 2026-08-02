use crate::error::AppError;
use crate::json_bson::canonical_string_to_bson;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures::io::AsyncReadExt;
use mongodb::options::GridFsBucketOptions;
use tauri::{ipc::Channel, State};

use super::import_export::{check_cancelled, cleanup_on_err, create_output_writer};

/// Hard cap on `gridfs_preview_bytes` -- defense in depth; the frontend already skips calling this
/// once a file's known `length` exceeds the cap (see `domain/gridfsPreview.ts`'s
/// `GRIDFS_PREVIEW_CAP_BYTES`, which must stay in sync with this value). The read is bounded via
/// `.take()` so an oversized file is never buffered in full before being rejected -- same class of
/// fix as the 2026-07-26 audit's `export_query_progress` "Show all" byte cap.
const PREVIEW_CAP_BYTES: usize = 5 * 1024 * 1024;

/// Bytes read per iteration while streaming a GridFS download to disk -- matches GridFS's own
/// default chunk size (255 KiB), a reasonable balance between syscall count and progress granularity.
const DOWNLOAD_BUF_SIZE: usize = 262_144;

/// Emit a download progress event at most once per this many bytes written.
const PROGRESS_BATCH_BYTES: u64 = 1_048_576;

#[derive(serde::Serialize, Clone)]
pub struct GridfsDownloadProgress {
    pub done: u64,
    pub total: u64,
}

/// Tracks the actual cumulative bytes written during a streaming download and decides when a
/// batched progress event should fire (every `PROGRESS_BATCH_BYTES`). Kept separate from the I/O
/// loop so the accounting/batching logic is unit-testable without a live GridFS stream -- `done()`
/// is the real number of bytes streamed so far, independent of any caller-supplied declared length.
struct DownloadProgressTracker {
    done: u64,
    last_emit: u64,
}

impl DownloadProgressTracker {
    fn new() -> Self {
        Self { done: 0, last_emit: 0 }
    }

    /// Records `n` newly-written bytes; returns `Some(actual_done)` when a progress event should
    /// be emitted for the real cumulative byte count, `None` otherwise.
    fn record(&mut self, n: u64) -> Option<u64> {
        self.done += n;
        if self.done - self.last_emit >= PROGRESS_BATCH_BYTES {
            self.last_emit = self.done;
            Some(self.done)
        } else {
            None
        }
    }

    /// The real cumulative byte count streamed so far.
    fn done(&self) -> u64 {
        self.done
    }
}

/// Builds a `GridFsBucket` for `bucket` (the naming-convention prefix before `.files`/`.chunks`).
///
/// `mongodb::gridfs::GridFsBucketOptions` itself is `pub(crate)`, but the same type is re-exported
/// publicly at `mongodb::options::GridFsBucketOptions` (via the crate's top-level `options` module
/// wildcard `pub use`), so it's reachable through that path with a type-safe builder.
fn bucket_for(client: &mongodb::Client, db: &str, bucket: &str) -> mongodb::gridfs::GridFsBucket {
    let opts = GridFsBucketOptions::builder().bucket_name(bucket.to_string()).build();
    client.database(db).gridfs_bucket(Some(opts))
}

/// Reads a GridFS file's bytes (bounded to `PREVIEW_CAP_BYTES + 1`) and returns them base64-encoded.
/// Errors if the file turns out to exceed the cap -- the frontend is expected to have already
/// skipped this call using the file's known `length`, but this is enforced server-side too.
#[tauri::command]
pub async fn gridfs_preview_bytes(
    session_id: String,
    db: String,
    bucket: String,
    file_id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let client = state.client(&session_id).await?;
    let id = canonical_string_to_bson(&file_id)?;
    let gridfs_bucket = bucket_for(&client, &db, &bucket);
    let stream = gridfs_bucket.open_download_stream(id).await?;

    let mut buf = Vec::with_capacity(PREVIEW_CAP_BYTES + 1);
    stream
        .take((PREVIEW_CAP_BYTES + 1) as u64)
        .read_to_end(&mut buf)
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    if buf.len() > PREVIEW_CAP_BYTES {
        return Err(AppError::Query(format!(
            "File exceeds the {}MB preview limit -- download it instead.",
            PREVIEW_CAP_BYTES / (1024 * 1024)
        )));
    }
    Ok(STANDARD.encode(&buf))
}

/// Streams a GridFS file straight to `dest_path` on disk -- bytes never round-trip through the
/// frontend. Checks the session's cooperative cancel flag every read iteration (same mechanism
/// `cancel_export`/`cancel_script`/`cancel_import` already share); the frontend cancels this by
/// invoking the existing `cancel_export` command, no new cancel endpoint needed. `total_bytes` is
/// supplied by the caller (already known from the file's list row) rather than re-queried here.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn gridfs_download(
    session_id: String,
    db: String,
    bucket: String,
    file_id: String,
    total_bytes: u64,
    dest_path: String,
    on_progress: Channel<GridfsDownloadProgress>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let cancel = state.begin_cancel(&session_id).await;
    let client = state.client(&session_id).await?;
    let id = canonical_string_to_bson(&file_id)?;
    let gridfs_bucket = bucket_for(&client, &db, &bucket);
    let mut stream = gridfs_bucket.open_download_stream(id).await?;

    let p = std::path::Path::new(&dest_path);
    let mut w = create_output_writer(p)?;

    let bytes_written = cleanup_on_err(p, async {
        use std::io::Write;
        let mut buf = vec![0u8; DOWNLOAD_BUF_SIZE];
        let mut tracker = DownloadProgressTracker::new();
        loop {
            check_cancelled(&cancel)?;
            let n = stream.read(&mut buf).await.map_err(|e| AppError::Io(e.to_string()))?;
            if n == 0 {
                break;
            }
            w.write_all(&buf[..n]).map_err(|e| AppError::Io(e.to_string()))?;
            if let Some(done) = tracker.record(n as u64) {
                let _ = on_progress.send(GridfsDownloadProgress { done, total: total_bytes });
            }
        }
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(tracker.done())
    })
    .await?;

    // Report the actual number of bytes streamed/written, not the caller-supplied `total_bytes` --
    // that declared length (from GridFS file metadata) can be stale or wrong.
    let _ = on_progress.send(GridfsDownloadProgress { done: bytes_written, total: total_bytes });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracker_reports_no_progress_event_below_the_batch_threshold() {
        let mut t = DownloadProgressTracker::new();
        assert_eq!(t.record(1024), None);
        assert_eq!(t.done(), 1024);
    }

    #[test]
    fn tracker_emits_once_the_batch_threshold_is_crossed() {
        let mut t = DownloadProgressTracker::new();
        assert_eq!(t.record(PROGRESS_BATCH_BYTES - 1), None);
        assert_eq!(t.record(1), Some(PROGRESS_BATCH_BYTES));
        assert_eq!(t.done(), PROGRESS_BATCH_BYTES);
    }

    #[test]
    fn tracker_final_done_reflects_actual_bytes_streamed_not_a_declared_total() {
        // Regression: the final progress event must report the real cumulative bytes written, not
        // a caller-supplied/declared `total_bytes` that may be stale or wrong (e.g. GridFS metadata
        // says 10MB but the file only actually has 7MB of chunks).
        let mut t = DownloadProgressTracker::new();
        let chunks = [DOWNLOAD_BUF_SIZE as u64, DOWNLOAD_BUF_SIZE as u64, 123u64];
        let mut emitted = Vec::new();
        for &n in &chunks {
            if let Some(done) = t.record(n) {
                emitted.push(done);
            }
        }
        let actual_total: u64 = chunks.iter().sum();
        assert_eq!(t.done(), actual_total);
        // A stale declared length wildly different from the real stream must never surface as `done`.
        let bogus_declared_total = actual_total + 999_999;
        assert_ne!(t.done(), bogus_declared_total);
    }
}
