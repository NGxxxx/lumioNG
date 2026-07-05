import { untrack } from "svelte";
import { runScript, cancelScript, type ConsoleEntry, type Provenance } from "../api/script";
import { sampleDocuments } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows, type DisplayMode } from "../domain/scriptOutcome";
import { mergeColumns, inferSchema, getByPath, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive } from "../domain/scriptScan";
import { settings } from "./settings.svelte";
import { updateOne, deleteMany } from "../api/documents";
import { idJson } from "../domain/docid";
import { isInlineEditable, editTextOf, rebuildValue, buildSetUpdate } from "../domain/celledit";
import { errorMessage } from "../api/errors";
import * as m from "$lib/paraglide/messages";
import { idInFilter, rangeBetween, effectiveRows as effectiveRowsOf } from "../domain/selection";
import { toJsonArray, toCsv } from "../domain/exporter";
import type { ExportWizardInput } from "../domain/exportPlan";
import type { MenuItem } from "../components/ContextMenu.svelte";

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
  let lastElapsedMs = $state<number | null>(null);

  let pageSize = $state(50);
  let pageReq = $state(1);
  let showingAll = $state(false);

  let destructiveConfirm = $state<{ ops: string[] } | null>(null);
  let pending: { db: string; script: string } | null = null;

  // Inline cell edit (row index is page-relative; mapped to backing docs on commit).
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Row selection (page-relative indices into pageDocs).
  let selected = $state<Set<number>>(new Set());
  let anchor: number | null = null;
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);
  let ioError = $state<string | null>(null);
  let confirmDelete = $state<{ count: number; picked: Doc[] } | null>(null);
  let exportRequest = $state<{ rows: Doc[] } | null>(null);

  /** Map a page-relative row index to the absolute index in `docs`. */
  function absIndex(row: number): number {
    return (page - 1) * pageSize + row;
  }

  /** True when edit/delete actions are permitted (pure single-collection cursor result). */
  function isEditable(): boolean {
    return displayModeVal === "grid-editable" && provenance !== null;
  }

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
  const pgCount = $derived(showingAll ? 1 : pageCount(totalCount, pageSize));
  const page = $derived(showingAll ? 1 : clampPage(pageReq, pgCount));
  const pageDocs = $derived(
    showingAll ? docs : docs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
  );

  async function execute(db: string, script: string) {
    running = true;
    error = null;
    selected = new Set();
    anchor = null;
    menu = null;
    editing = null;
    showingAll = false;
    const startedAt = Date.now();
    try {
      const outcome = await runScript(sessionId, db, script, {
        timeoutMs: settings.queryTimeoutMs,
        cap: settings.queryResultCapUnlimited ? 0 : settings.queryResultCap,
      });

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
      lastElapsedMs = Date.now() - startedAt;
      running = false;
    }
  }

  function clearConsole() {
    consoleEntries = [];
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

  /** Show every already-fetched doc on one page (no further server round-trip needed — the
   *  script already returned this run's full result set, up to the configured cap). */
  function showAll() {
    editing = null;
    showingAll = true;
  }

  function backToPaged() {
    editing = null;
    showingAll = false;
    pageReq = 1;
  }

  function startEdit(row: number, key: string) {
    if (!isEditable()) return;
    if (key.includes(".")) return; // nested fields not supported inline
    const doc = pageDocs[row];
    if (!doc || idJson(doc) === null) return;
    const value = getByPath(doc, key);
    if (!isInlineEditable(key, value)) return;
    editing = { row, key };
    editText = editTextOf(value);
    editError = null;
  }

  function cancelEdit() {
    if (saving) return;
    editing = null;
    editError = null;
  }

  async function commitEdit() {
    if (!editing || saving || !provenance) return;
    const { row, key } = editing;
    const doc = pageDocs[row];
    if (!doc) { editing = null; return; }
    const r = rebuildValue(getByPath(doc, key), editText);
    if (!r.ok) { editError = r.error; return; }
    const id = idJson(doc);
    if (id === null) { editError = m.query_run_selection_missing_id(); return; }
    const filter = `{"_id": ${id}}`;
    const update = buildSetUpdate(key, r.value);
    saving = true;
    try {
      await updateOne(sessionId, provenance.db, provenance.coll, filter, update, false);
      const gi = absIndex(row);
      docs = docs.map((d, i) => (i === gi ? { ...d, [key]: r.value } : d));
      editing = null;
      editError = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  function clickRow(row: number, mods: { ctrl: boolean; shift: boolean }) {
    if (mods.shift && anchor !== null) {
      selected = new Set(rangeBetween(anchor, row));
      return;
    }
    if (mods.ctrl) {
      const next = new Set(selected);
      if (next.has(row)) next.delete(row); else next.add(row);
      selected = next; anchor = row; return;
    }
    selected = new Set([row]); anchor = row;
  }

  function openMenu(e: MouseEvent, row: number, key: string) {
    e.preventDefault(); e.stopPropagation();
    if (!selected.has(row)) { selected = new Set([row]); anchor = row; }
    menu = { x: e.clientX, y: e.clientY, row, key };
  }

  function closeMenu() { menu = null; }

  function effectiveRows(): number[] {
    return effectiveRowsOf(menu ? menu.row : null, selected);
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const doc = pageDocs[menu.row];
    const n = effectiveRows().length;
    const hasId = doc ? idJson(doc) !== null : false;
    const editable = isEditable();
    const allHaveId = effectiveRows().every((r) => { const d = pageDocs[r]; return d ? idJson(d) !== null : false; });
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: "Open document", action: "open", disabled: !hasId || n !== 1 });
      items.push({
        label: "Edit cell", action: "editCell",
        disabled: !doc || menu.key.includes(".") || idJson(doc) === null
          || !isInlineEditable(menu.key, getByPath(doc, menu.key)),
      });
    }
    const copyChildren: MenuItem[] = [
      { label: "Value", action: "copyValue" },
      { label: "_id", action: "copyId", disabled: !hasId },
      { label: `Selected (${n}) as JSON`, action: "copyJson" },
      { label: `Selected (${n}) as CSV`, action: "copyCsv" },
    ];
    if (editable) {
      items.push({ label: "Copy", action: "copy", children: copyChildren });
    } else {
      items.push(...copyChildren);
    }
    items.push({ label: "Export", action: "export", children: [
      { label: `Selected (${n}) to file…`, action: "exportSelected" },
      { label: "All results to file…", action: "exportAll" },
    ]});
    if (editable) {
      items.push({ label: `Delete selected (${n})`, action: "deleteSelected", disabled: !allHaveId });
    }
    return items;
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { ioError = m.common_clipboard_failed(); }
  }

  function onMenuSelect(action: string): { open: Doc } | null {
    if (!menu) return null;
    const doc = pageDocs[menu.row];
    const key = menu.key;
    const rows = effectiveRows();
    const picked = rows.map((r) => pageDocs[r]).filter(Boolean) as Doc[];
    switch (action) {
      case "open": menu = null; return doc ? { open: doc } : null;
      case "editCell": { const r = menu.row; const k = menu.key; menu = null; startEdit(r, k); return null; }
      case "copyValue": copy(JSON.stringify(getByPath(doc, key))); break;
      case "copyId": copy(idJson(doc) ?? ""); break;
      case "copyJson": copy(toJsonArray(picked)); break;
      case "copyCsv": copy(toCsv(picked)); break;
      case "exportSelected": exportRequest = { rows: picked }; break;
      case "exportAll": exportRequest = { rows: docs }; break;
      case "deleteSelected": requestDelete(picked); break;
    }
    menu = null;
    return null;
  }

  function requestDelete(picked: Doc[]) {
    if (picked.length === 0) return;
    confirmDelete = { count: picked.length, picked };
  }
  function cancelDelete() { confirmDelete = null; }
  async function confirmDeleteRun() {
    const c = confirmDelete;
    confirmDelete = null;
    if (c) await deleteSelected(c.picked);
  }

  async function deleteSelected(picked: Doc[]) {
    if (!provenance) return;
    const ids: string[] = [];
    for (const d of picked) {
      const id = idJson(d);
      if (id === null) { ioError = m.query_run_selection_missing_id(); return; }
      ids.push(id);
    }
    const filter = idInFilter(ids);
    try {
      await deleteMany(sessionId, provenance.db, provenance.coll, filter, false);
      docs = docs.filter((d) => { const id = idJson(d); return id === null || !ids.includes(id); });
      selected = new Set();
      anchor = null;
      editing = null;
    } catch (e) {
      ioError = errorMessage(e);
    }
  }

  function cancelExport() { exportRequest = null; }

  function exportInput(): ExportWizardInput | null {
    if (!exportRequest) return null;
    const colPaths = columns.map((c) => ({ path: c.path, visible: true }));
    const n = exportRequest.rows.length;
    return {
      mode: "scopedMemory",
      coll: provenance?.coll ?? "results",
      docs: exportRequest.rows,
      columns: colPaths,
      summary: n === 1
        ? m.export_dialog_summary_selection_one({ count: n })
        : m.export_dialog_summary_selection_many({ count: n }),
    };
  }

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; },
    get docs() { return docs; },
    get columns() { return columns; },
    get pageDocs() { return pageDocs; },
    get consoleEntries() { return consoleEntries; },
    get lastElapsedMs() { return lastElapsedMs; },
    clearConsole,
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
    get allShown() { return showingAll; },
    get colWidths() { return colWidths; },
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
    goToPage: (p: number) => { editing = null; pageReq = clampPage(p, pgCount); },
    setPageSize: (n: number) => { editing = null; pageSize = Math.max(1, Math.floor(n) || 50); pageReq = 1; },
    showAll,
    backToPaged,
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
    get editing() { return editing; },
    get editText() { return editText; },
    set editText(v: string) { editText = v; },
    get editError() { return editError; },
    startEdit,
    commitEdit,
    cancelEdit,
    get selected() { return selected; },
    get menu() { return menu; },
    clickRow,
    openMenu,
    closeMenu,
    menuItems,
    onMenuSelect,
    get ioError() { return ioError; },
    get confirmDelete() { return confirmDelete; },
    cancelDelete,
    confirmDeleteRun,
    get exportRequest() { return exportRequest; },
    cancelExport,
    exportInput,
  };
}
