import { exportJsonProgress, exportBsonProgress, exportCsvProgress, exportSqlProgress } from "../api/documents";
import { writeTextFile } from "../api/files";
import { toCsv, toJsonArray, toSql } from "../domain/exporter";
import { exportFileName, aggregateProgress } from "../domain/exportPlan";
import { findCmd, exportBsonCmd } from "../domain/mongosh";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import * as m from "$lib/paraglide/messages";
import { errorMessage } from "../api/errors";
import type { Doc } from "../domain/doc";

export type ExportFormat = "json" | "csv" | "bson" | "sql";

export type ExportSource =
  | { kind: "query"; filter: string; sort: string | null; projection: string | null }
  | { kind: "memory"; docs: Doc[] };

export interface ExportTarget {
  db: string;
  coll: string;
  source: ExportSource;
}

export type RowStatus = "pending" | "running" | "done" | "error";

export interface ExportRow {
  db: string;
  coll: string;
  status: RowStatus;
  done: number;
  total: number;
  error: string | null;
}

export interface ExportJobConfig {
  targets: ExportTarget[];
  format: ExportFormat;
  /** Picker mode: output folder, one file per target. */
  dir?: string;
  /** Scoped mode: single explicit output file. */
  filePath?: string;
}

export function createExportJob(sessionId: string, config: ExportJobConfig) {
  let rows = $state.raw<ExportRow[]>(
    config.targets.map((t) => ({ db: t.db, coll: t.coll, status: "pending", done: 0, total: 0, error: null })),
  );
  let running = $state(false);
  let finished = $state(false);
  let cancelled = false;

  const overall = $derived(aggregateProgress(rows));
  const succeeded = $derived(rows.filter((r) => r.status === "done").length);
  const failed = $derived(rows.filter((r) => r.status === "error").length);

  function pathFor(i: number): string {
    if (config.filePath) return config.filePath;
    const dir = (config.dir ?? "").replace(/[\\/]+$/, "");
    return `${dir}/${exportFileName(rows[i].db, rows[i].coll, config.format)}`;
  }

  function update(i: number, patch: Partial<ExportRow>) {
    rows[i] = { ...rows[i], ...patch };
    rows = [...rows];
  }

  async function runOne(i: number) {
    const t = config.targets[i];
    const path = pathFor(i);
    update(i, { status: "running" });
    const onProg = (done: number, total: number) => update(i, { done, total });
    try {
      const toText = (data: Doc[]) => (config.format === "csv" ? toCsv(data) : config.format === "sql" ? toSql(data, t.coll) : toJsonArray(data));
      if (t.source.kind === "memory") {
        const data = t.source.docs;
        await commandLog.pushTimed(findCmd({ coll: t.coll, filter: "{}" }), sessionId, () =>
          writeTextFile(path, toText(data)));
        update(i, { status: "done", done: data.length, total: data.length });
        return;
      }
      const { filter, sort, projection } = t.source;
      if (config.format === "bson") {
        const n = await commandLog.pushTimed(exportBsonCmd(t.db, t.coll, path), sessionId, () =>
          exportBsonProgress(sessionId, t.db, t.coll, filter, sort, projection, path, onProg));
        update(i, { status: "done", done: n, total: n });
      } else if (config.format === "json") {
        const n = await commandLog.pushTimed(findCmd({ coll: t.coll, filter, sort, projection }), sessionId, () =>
          exportJsonProgress(sessionId, t.db, t.coll, filter, sort, projection, path, onProg));
        update(i, { status: "done", done: n, total: n });
      } else if (config.format === "csv") {
        const n = await commandLog.pushTimed(findCmd({ coll: t.coll, filter, sort, projection }), sessionId, () =>
          exportCsvProgress(sessionId, t.db, t.coll, filter, sort, projection, path, onProg));
        update(i, { status: "done", done: n, total: n });
      } else {
        const n = await commandLog.pushTimed(findCmd({ coll: t.coll, filter, sort, projection }), sessionId, () =>
          exportSqlProgress(sessionId, t.db, t.coll, filter, sort, projection, path, onProg));
        update(i, { status: "done", done: n, total: n });
      }
    } catch (e) {
      update(i, { status: "error", error: errorMessage(e) });
    }
  }

  async function run() {
    if (running || finished) return;
    running = true;
    activity.begin(m.common_running());
    try {
      for (let i = 0; i < config.targets.length; i++) {
        if (cancelled) break;
        await runOne(i);
      }
    } finally {
      activity.end();
    }
    running = false;
    finished = true;
  }

  function cancel() {
    cancelled = true;
  }

  return {
    get rows() { return rows; },
    get running() { return running; },
    get done() { return finished; },
    get overall() { return overall; },
    get succeeded() { return succeeded; },
    get failed() { return failed; },
    run,
    cancel,
  };
}
