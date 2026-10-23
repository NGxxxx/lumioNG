import type { InsertMode } from "../api/documents";
import { metadataPathFor } from "../domain/collectionMetadata";
import { batchTargetErrors, planImportBatch, type BatchPlanEntry } from "../domain/importBatch";
import { readOptionalTextFile } from "./desktop";
import { createImportJob } from "./importJob.svelte";
import { createCsvImport } from "./csvImport.svelte";
import { jobs } from "./jobs.svelte";
import * as m from "#lib/paraglide/messages.js";

export type BatchRowStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";
export type BatchRow = BatchPlanEntry & {
  status: BatchRowStatus;
  inserted: number;
  failedDocs: number;
  error: string | null;
};

/** Imports several JSON / JSONL / BSON / CSV files into one database, one collection per file,
 *  one after another (CSV with its default options). A file's `.metadata.json` sidecar (indexes,
 *  validator — what `mongodump` writes next to each `.bson`) is applied when present and enabled. */
export function createImportBatch(args: { sessionId: string; db: string; paths: string[] }) {
  const { sessionId, db } = args;
  // Small (one row per file) and replaced as a whole on every change.
  let rows = $state.raw<BatchRow[]>(
    planImportBatch(args.paths).map((e) => ({ ...e, status: e.skip ? "skipped" : "pending", inserted: 0, failedDocs: 0, error: null })),
  );
  let insertMode = $state<InsertMode>("skipDuplicates");
  let restoreMetadata = $state(true);
  let running = $state(false);
  let finished = $state(false);
  let cancelRequested = false;
  // Live progress of the file being imported: reads the running job's own reactive progress.
  let progressOf = $state.raw<(() => { done: number; total: number } | null) | null>(null);

  const errors = $derived(batchTargetErrors(rows));
  const importable = $derived(rows.filter((r) => !r.skip).length);
  const completed = $derived(rows.filter((r) => r.status === "done" || r.status === "failed").length);
  const canStart = $derived(!running && !finished && importable > 0 && errors.every((e) => e === null));

  function patch(i: number, p: Partial<BatchRow>) {
    rows = rows.map((r, j) => (j === i ? { ...r, ...p } : r));
  }

  function setColl(i: number, coll: string) {
    if (!running && !finished) patch(i, { coll });
  }

  async function importOne(r: BatchRow): Promise<Pick<BatchRow, "inserted" | "failedDocs" | "error">> {
    const coll = r.coll.trim();
    const bundle = restoreMetadata ? await readOptionalTextFile(metadataPathFor(r.path)).catch(() => null) : null;
    if (r.format === "csv") {
      const csv = createCsvImport(sessionId, db, coll, r.path, insertMode);
      await csv.loadPreview();
      if (csv.columns.length === 0) return { inserted: 0, failedDocs: 0, error: csv.error ?? m.csv_import_no_columns() };
      progressOf = () => csv.progress;
      await csv.run(bundle);
      return { inserted: csv.result?.inserted ?? 0, failedDocs: csv.result?.failed ?? 0, error: csv.error ?? csv.metadataError };
    }
    const job = createImportJob({ sessionId, db, coll, path: r.path, insertMode, restoreMetadataBundle: bundle });
    progressOf = () => ({ done: job.done, total: job.total });
    await job.run();
    return { inserted: job.result?.inserted ?? 0, failedDocs: job.result?.failed ?? 0, error: job.error ?? job.metadataError };
  }

  async function run() {
    if (!canStart) return;
    running = true;
    cancelRequested = false;
    jobs.register({
      kind: "import",
      label: m.jobs_import_label({ target: db }),
      progress: () => (importable > 0 ? Math.min(100, (completed / importable) * 100) : null),
      state: () => (running ? "running" : cancelRequested ? "cancelled" : rows.some((r) => r.status === "failed") ? "failed" : "done"),
      cancel,
      summary: () => m.jobs_import_finished({ target: db }),
      details: () => rows.filter((r) => !r.skip).map((r) => ({ label: `${db}.${r.coll.trim()}`, state: r.status })),
    });
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.status !== "pending") continue;
        if (cancelRequested) {
          patch(i, { status: "cancelled" });
          continue;
        }
        patch(i, { status: "running" });
        progressOf = null;
        const out = await importOne(r);
        patch(i, { ...out, status: out.error && out.inserted === 0 ? "failed" : "done" });
      }
    } finally {
      progressOf = null;
      running = false;
      finished = true;
    }
  }

  /** Stops after the file being imported (a file is never cut in half). */
  function cancel() {
    if (running) cancelRequested = true;
  }

  return {
    get rows() { return rows; },
    get errors() { return errors; },
    get insertMode() { return insertMode; },
    set insertMode(v: InsertMode) { insertMode = v; },
    get restoreMetadata() { return restoreMetadata; },
    set restoreMetadata(v: boolean) { restoreMetadata = v; },
    get importable() { return importable; },
    get completed() { return completed; },
    get current() { return progressOf?.() ?? null; },
    get running() { return running; },
    get finished() { return finished; },
    get canStart() { return canStart; },
    setColl,
    run,
    cancel,
  };
}
