import { untrack } from "svelte";
import { runScript, cancelScript, type ConsoleEntry, type Provenance } from "../api/script";
import { sampleDocuments } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows, type DisplayMode } from "../domain/scriptOutcome";
import { mergeColumns, inferSchema, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive } from "../domain/scriptScan";
import { settings } from "./settings.svelte";

/** Per-tab state for one QuickJS Query tab: run script + client-side paging + column widths. */
export function createQueryScript(sessionId: string, initialStatement: string) {
  // Wrap initialStatement with untrack to avoid state_referenced_locally warning
  // when this store is created inside a reactive context (e.g. Svelte 5 component).
  let statementText = $state(untrack(() => initialStatement));

  // $state.raw: large arrays replaced wholesale, never mutated in place (avoids deep-proxy RAM blowup).
  let docs = $state.raw<Doc[]>([]);
  // $state.raw: same rationale as docs.
  let consoleEntries = $state.raw<ConsoleEntry[]>([]);

  let columns = $state<ColumnField[]>([]);
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});

  let displayModeVal = $state<DisplayMode>("none");
  let valueJson = $state<string | null>(null);
  let ackJson = $state<string | null>(null);
  let capped = $state(false);
  let error = $state<string | null>(null);
  let running = $state(false);
  let provenance = $state<Provenance | null>(null);

  let view = $state<"grid" | "tree">("grid");
  let pageSize = $state(50);
  let pageReq = $state(1);

  let destructiveConfirm = $state<{ ops: string[] } | null>(null);
  let pending: { db: string; script: string } | null = null;

  // Autocomplete field cache: one sample() per (db, coll) for this tab's lifetime.
  const fieldCache = new Map<string, string[]>();
  const fieldInflight = new Map<string, Promise<string[]>>();

  async function fieldsFor(db: string, coll: string): Promise<string[]> {
    const key = `${db} ${coll}`;
    const cached = fieldCache.get(key);
    if (cached) return cached;
    const pending = fieldInflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      try {
        const sampledDocs = await sampleDocuments(sessionId, db, coll, "{}", 50);
        const paths = inferSchema(sampledDocs).fields.map((f) => f.path);
        fieldCache.set(key, paths);
        return paths;
      } catch {
        return []; // autocomplete degrades silently; never throw into the editor
      } finally {
        fieldInflight.delete(key);
      }
    })();
    fieldInflight.set(key, p);
    return p;
  }

  // Editor selection range (chars into statementText), kept in sync by the textarea.
  // Enables "Run selection": run only the highlighted statement instead of the whole editor.
  let selStart = $state(0);
  let selEnd = $state(0);
  const hasSelection = $derived(selStart !== selEnd && statementText.slice(selStart, selEnd).trim().length > 0);

  function setSelection(start: number, end: number) {
    selStart = start;
    selEnd = end;
  }

  const totalCount = $derived(docs.length);
  const pgCount = $derived(pageCount(totalCount, pageSize));
  const page = $derived(clampPage(pageReq, pgCount));
  const pageDocs = $derived(docs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize));

  async function execute(db: string, script: string) {
    running = true;
    error = null;
    try {
      const outcome = await runScript(sessionId, db, script);

      // Console entries (always present)
      consoleEntries = outcome.console;

      // Compute display mode
      displayModeVal = computeDisplayMode(outcome);

      // Map result by kind
      if (outcome.result.kind === "docs") {
        const rows = outcome.result.rows;
        docs = parseRows(rows);
        columns = mergeColumns(null, docs);
        defaultColWidths = computeColumnWidths(columns, docs);
        colWidths = { ...defaultColWidths };
        provenance = outcome.provenance;
        capped = outcome.capped;
        valueJson = null;
        ackJson = null;
      } else if (outcome.result.kind === "value") {
        valueJson = outcome.result.json;
        docs = [];
        columns = [];
        provenance = null;
        capped = false;
        ackJson = null;
      } else if (outcome.result.kind === "ack") {
        ackJson = outcome.result.json;
        docs = [];
        columns = [];
        provenance = null;
        capped = false;
        valueJson = null;
      } else {
        // kind === "none"
        docs = [];
        columns = [];
        provenance = null;
        capped = false;
        valueJson = null;
        ackJson = null;
      }

      error = outcome.error;
      pageReq = 1;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      running = false;
    }
  }

  async function run(db: string | null, script: string = statementText) {
    if (!db) {
      error = "Select a database first.";
      return;
    }
    const ops = scanDestructive(script);
    if (ops.length && !settings.suppressDestructiveWarning) {
      pending = { db, script };
      destructiveConfirm = { ops };
      return;
    }
    await execute(db, script);
  }

  async function confirmRun() {
    const p = pending;
    destructiveConfirm = null;
    pending = null;
    if (p) await execute(p.db, p.script);
  }

  function cancelConfirm() {
    destructiveConfirm = null;
    pending = null;
  }

  function dontAskAgain() {
    settings.setSuppressDestructiveWarning(true);
    void confirmRun();
  }

  function cancel() {
    cancelScript(sessionId);
  }

  /** Run only the highlighted text (falls back to the whole statement if nothing is selected). */
  function runSelection(db: string | null) {
    const stmt = hasSelection ? statementText.slice(selStart, selEnd) : statementText;
    return run(db, stmt);
  }

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; },
    get docs() { return docs; },
    get columns() { return columns; },
    get pageDocs() { return pageDocs; },
    get consoleEntries() { return consoleEntries; },
    get displayMode() { return displayModeVal; },
    get valueJson() { return valueJson; },
    get ackJson() { return ackJson; },
    get capped() { return capped; },
    get error() { return error; },
    get running() { return running; },
    get provenance() { return provenance; },
    get currentPage() { return page; },
    get pageCount() { return pgCount; },
    get pageSize() { return pageSize; },
    get colWidths() { return colWidths; },
    get view() { return view; },
    set view(v: "grid" | "tree") { view = v; },
    get destructiveConfirm() { return destructiveConfirm; },
    run: (db: string | null) => run(db),
    confirmRun,
    cancelConfirm,
    dontAskAgain,
    cancel,
    runSelection,
    setSelection,
    fieldsFor,
    get hasSelection() { return hasSelection; },
    goToPage: (p: number) => { pageReq = clampPage(p, pgCount); },
    setPageSize: (n: number) => { pageSize = Math.max(1, Math.floor(n) || 50); pageReq = 1; },
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
  };
}
