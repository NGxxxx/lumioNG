import { csvImportPreview, csvImportCommit, type CsvDelimiter, type CsvColumnPreview } from "../api/csv";
import type { ImportResult, InsertMode } from "../api/documents";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { csvImportCmd } from "../domain/mongosh";
import * as m from "$lib/paraglide/messages";

export type CsvImportPhase = "loading" | "config" | "running" | "done";

/** Drives ImportDialog's CSV flow: preview (columns/types/samples, delimiter + infer toggles) → run. */
export function createCsvImport(
  sessionId: string,
  db: string,
  coll: string,
  path: string,
  initialInsertMode: InsertMode,
) {
  let phase = $state<CsvImportPhase>("loading");
  let delimiter = $state<CsvDelimiter>("comma");
  let parseJsonLike = $state(true);
  let inferScalars = $state(true);
  let columns = $state<CsvColumnPreview[]>([]);
  let error = $state<string | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  let result = $state<ImportResult | null>(null);
  let insertMode = $state(initialInsertMode);

  async function loadPreview() {
    phase = "loading";
    error = null;
    try {
      columns = await csvImportPreview(path, delimiter, { parseJsonLike, inferScalars });
    } catch (e) {
      error = errorMessage(e);
    } finally {
      // Always leave "loading" — on failure this shows the empty-state + error instead of a stuck spinner.
      phase = "config";
    }
  }

  async function setDelimiter(d: CsvDelimiter) {
    delimiter = d;
    await loadPreview();
  }

  async function toggleParseJsonLike() {
    parseJsonLike = !parseJsonLike;
    await loadPreview();
  }

  async function toggleInferScalars() {
    inferScalars = !inferScalars;
    await loadPreview();
  }

  function setInsertMode(m: InsertMode) {
    insertMode = m;
  }

  async function run() {
    if (phase === "running") return;
    phase = "running";
    error = null;
    activity.begin(m.common_running());
    try {
      result = await commandLog.pushTimed(csvImportCmd(db, coll, path), sessionId, () =>
        csvImportCommit(sessionId, db, coll, path, delimiter, { parseJsonLike, inferScalars }, insertMode, (done, total) => {
          progress = { done, total };
        }));
      phase = "done";
    } catch (e) {
      error = errorMessage(e);
      phase = "config";
    } finally {
      activity.end();
    }
  }

  return {
    get phase() { return phase; },
    get delimiter() { return delimiter; },
    get parseJsonLike() { return parseJsonLike; },
    get inferScalars() { return inferScalars; },
    get columns() { return columns; },
    get error() { return error; },
    get progress() { return progress; },
    get result() { return result; },
    loadPreview,
    setDelimiter,
    toggleParseJsonLike,
    toggleInferScalars,
    setInsertMode,
    run,
  };
}
