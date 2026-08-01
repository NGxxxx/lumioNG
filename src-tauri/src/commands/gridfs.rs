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

    let mut buf = Vec::new();
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

    cleanup_on_err(p, async {
        use std::io::Write;
        let mut buf = vec![0u8; DOWNLOAD_BUF_SIZE];
        let mut done: u64 = 0;
        let mut last_emit: u64 = 0;
        loop {
            check_cancelled(&cancel)?;
            let n = stream.read(&mut buf).await.map_err(|e| AppError::Io(e.to_string()))?;
            if n == 0 {
                break;
            }
            w.write_all(&buf[..n]).map_err(|e| AppError::Io(e.to_string()))?;
            done += n as u64;
            if done - last_emit >= PROGRESS_BATCH_BYTES {
                last_emit = done;
                let _ = on_progress.send(GridfsDownloadProgress { done, total: total_bytes });
            }
        }
        w.flush().map_err(|e| AppError::Io(e.to_string()))?;
        Ok(done)
    })
    .await?;

    let _ = on_progress.send(GridfsDownloadProgress { done: total_bytes, total: total_bytes });
    Ok(())
}
