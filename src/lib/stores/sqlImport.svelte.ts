import { sqlImportPreview, sqlImportCommit, cancelSqlImport, type SqlTablePreview, type SqlImportTableResult } from "../api/sql";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { sqlImportCmd } from "../domain/mongosh";
import type { InsertMode } from "../api/documents";
import * as m from "$lib/paraglide/messages";

export type SqlImportPhase = "loading" | "selecting" | "running" | "done";

/** Drives ImportDialog's SQL flow: preview (list tables) → pick → commit, one collection per table. */
export function createSqlImport(
  sessionId: string,
  db: string,
  path: string,
  targetColl: string | null,
  insertMode: InsertMode,
) {
  let phase = $state<SqlImportPhase>("loading");
  let tables = $state<SqlTablePreview[]>([]);
  let selected = $state<Set<string>>(new Set());
  let error = $state<string | null>(null);
  let progress = $state<{ table: string; done: number; total: number } | null>(null);
  let results = $state<SqlImportTableResult[]>([]);
  let cancelled = $state(false);

  async function loadPreview() {
    phase = "loading";
    error = null;
    try {
      tables = await sqlImportPreview(path);
      selected = new Set(tables.map((t) => t.table));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      // Always leave "loading" — on failure this shows the empty-state + error instead of a stuck spinner.
      phase = "selecting";
    }
  }

  function toggle(table: string) {
    const next = new Set(selected);
    if (next.has(table)) next.delete(table);
    else next.add(table);
    selected = next;
  }

  function toggleAll() {
    selected = selected.size === tables.length ? new Set() : new Set(tables.map((t) => t.table));
  }

  async function run() {
    if (selected.size === 0 || phase === "running") return;
    phase = "running";
    error = null;
    const pickedTables = [...selected];
    activity.begin(m.common_running());
    try {
      const result = await commandLog.pushTimed(sqlImportCmd(db, path, pickedTables), sessionId, () =>
        sqlImportCommit(sessionId, db, path, pickedTables, targetColl, insertMode, (table, done, total) => {
          progress = { table, done, total };
        }));
      results = result.tables;
      cancelled = result.cancelled;
      phase = "done";
    } catch (e) {
      error = errorMessage(e);
      phase = "selecting";
    } finally {
      activity.end();
    }
  }

  function cancel() {
    if (phase === "running") void cancelSqlImport(sessionId);
  }

  return {
    get phase() { return phase; },
    get tables() { return tables; },
    get selected() { return selected; },
    get error() { return error; },
    get progress() { return progress; },
    get results() { return results; },
    get cancelled() { return cancelled; },
    loadPreview,
    toggle,
    toggleAll,
    run,
    cancel,
  };
}
