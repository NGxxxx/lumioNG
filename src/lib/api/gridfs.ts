import { invoke } from "@tauri-apps/api/core";
import { idJson } from "../domain/docid";
import { progressChannel, type ProgressCb } from "./documents";
import type { Doc } from "../domain/doc";

/** Base64-encodes a GridFS file's bytes, capped server-side at `PREVIEW_CAP_BYTES`
 *  (`src-tauri/src/commands/gridfs.rs`). Callers should already have checked the file's known
 *  `length` against `GRIDFS_PREVIEW_CAP_BYTES` before calling this. */
export async function gridfsPreviewBytes(sessionId: string, db: string, bucket: string, doc: Doc): Promise<string> {
  const fileId = idJson(doc);
  if (fileId === null) throw new Error("Document has no _id");
  return await invoke<string>("gridfs_preview_bytes", { sessionId, db, bucket, fileId });
}

/** Streams a GridFS file straight to `destPath` on disk; cancel it with `cancelExportProgress`. */
export async function gridfsDownload(
  sessionId: string,
  db: string,
  bucket: string,
  doc: Doc,
  totalBytes: number,
  destPath: string,
  onProgress: ProgressCb,
): Promise<void> {
  const fileId = idJson(doc);
  if (fileId === null) throw new Error("Document has no _id");
  await invoke<void>("gridfs_download", {
    sessionId, db, bucket, fileId, totalBytes, destPath, onProgress: progressChannel(onProgress),
  });
}
