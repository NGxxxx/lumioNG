import { gridfsDownload } from "../api/gridfs";
import { cancelExportProgress } from "../api/documents";
import { saveDialog } from "../api/files";
import { errorMessage } from "../api/errors";
import type { Doc } from "../domain/doc";

export type DownloadStatus = "idle" | "running" | "done" | "error" | "cancelled";

/** One-shot single-file GridFS download job (save dialog -> stream to disk -> progress), backing
 *  the Download button in the preview panel. Not cached/registered like `gridfsFiles` -- a new
 *  instance per invocation is created directly by the component that owns the button. */
export function createGridfsDownload(sessionId: string, db: string, bucket: string) {
  let status = $state<DownloadStatus>("idle");
  let done = $state(0);
  let total = $state(0);
  let error = $state<string | null>(null);
  let running = false;

  async function start(doc: Doc, filename: string, length: number): Promise<void> {
    const path = await saveDialog(filename, []);
    if (path === null) return;
    status = "running";
    done = 0;
    total = length;
    error = null;
    running = true;
    try {
      await gridfsDownload(sessionId, db, bucket, doc, length, path, (d, t) => {
        done = d;
        total = t;
      });
      status = "done";
    } catch (e) {
      const msg = errorMessage(e);
      status = msg.toLowerCase().includes("cancelled") ? "cancelled" : "error";
      error = msg;
    } finally {
      running = false;
    }
  }

  function cancel(): void {
    if (running) void cancelExportProgress(sessionId);
  }

  return {
    get status() { return status; },
    get done() { return done; },
    get total() { return total; },
    get error() { return error; },
    start,
    cancel,
  };
}

export type GridfsDownload = ReturnType<typeof createGridfsDownload>;
