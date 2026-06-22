import { aggregate, deleteMany } from "../api/documents";
import { saveDialog, writeTextFile } from "../api/files";
import type { Doc } from "../domain/columns";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { aggregateCmd, deleteManyCmd } from "../domain/mongosh";
import { parseAggregateStatement, pipelineHasTrailingLimit } from "../domain/aggregate";
import { mergeColumns, getByPath, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import { toJsonArray, toCsv } from "../domain/exporter";
import { idJson } from "../domain/docid";
import { idInFilter } from "../domain/selection";
import type { MenuItem } from "../components/ContextMenu.svelte";

const SAFETY_CAP = 200;

/** Per-tab state for one aggregate Query tab: parse + run + client-side paging + column widths. */
export function createQueryRun(initialStatement: string) {
  let statementText = $state(initialStatement);
  // $state.raw: result docs are replaced wholesale, never mutated in place. Avoids deep-proxying
  // every nested field (the main RAM sink for large result sets). See collectionView for rationale.
  let docs = $state.raw<Doc[]>([]);
  let columns = $state<ColumnField[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let capped = $state(false);
  let ran = $state(false);
  let view = $state<"grid" | "tree">("grid");
  let pageSize = $state(50);
  let pageReq = $state(1);
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});
  let srcDb = $state<string | null>(null);
  let srcColl = $state<string | null>(null);
  let selected = $state<Set<number>>(new Set());
  let anchor: number | null = null;
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);
  let ioError = $state<string | null>(null);
  let confirmDelete = $state<{ count: number; picked: Doc[] } | null>(null);

  // Editor selection range (chars into statementText), kept in sync by the textarea.
  // Enables "Run selection": run only the highlighted statement instead of the whole editor.
  let selStart = $state(0);
  let selEnd = $state(0);
  const hasSelection = $derived(selStart !== selEnd && statementText.slice(selStart, selEnd).trim().length > 0);

  const totalCount = $derived(docs.length);
  const pgCount = $derived(pageCount(totalCount, pageSize));
  const page = $derived(clampPage(pageReq, pgCount));
  const pageDocs = $derived(docs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize));

  async function exec(db: string | null, forceNoLimit: boolean, stmt: string = statementText) {
    if (!db) {
      error = "Select a database first.";
      return;
    }
    let parsed: { coll: string; pipelineText: string };
    try {
      parsed = parseAggregateStatement(stmt);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const limit = forceNoLimit || pipelineHasTrailingLimit(parsed.pipelineText) ? null : SAFETY_CAP;
    loading = true;
    try {
      const res = await aggregate(db, parsed.coll, parsed.pipelineText, limit);
      docs = res;
      columns = mergeColumns(null, res);
      defaultColWidths = computeColumnWidths(columns, res);
      colWidths = { ...defaultColWidths };
      capped = limit !== null && res.length === limit;
      pageReq = 1;
      commandLog.push(aggregateCmd(parsed.coll, parsed.pipelineText));
      error = null;
      ran = true;
      srcDb = db;
      srcColl = parsed.coll;
      selected = new Set();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  /** Run only the highlighted text (falls back to the whole statement if nothing is selected). */
  function runSelection(db: string | null) {
    const stmt = hasSelection ? statementText.slice(selStart, selEnd) : statementText;
    return exec(db, false, stmt);
  }

  function setSelection(start: number, end: number) {
    selStart = start;
    selEnd = end;
  }

  function clickRow(row: number, mods: { ctrl: boolean; shift: boolean }) {
    if (mods.shift && anchor !== null) {
      const [a, b] = anchor < row ? [anchor, row] : [row, anchor];
      const next = new Set<number>();
      for (let i = a; i <= b; i++) next.add(i);
      selected = next;
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
    if (!menu) return [...selected];
    return selected.has(menu.row) ? [...selected] : [menu.row];
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const doc = pageDocs[menu.row];
    const n = effectiveRows().length;
    const hasId = doc ? idJson(doc) !== null : false;
    const allHaveId = effectiveRows().every((r) => { const d = pageDocs[r]; return d ? idJson(d) !== null : false; });
    return [
      { label: "Open document", action: "open", disabled: !hasId || n !== 1 },
      { label: "Copy", action: "copy", children: [
        { label: "Value", action: "copyValue" },
        { label: "_id", action: "copyId", disabled: !hasId },
        { label: `Selected (${n}) as JSON`, action: "copyJson" },
        { label: `Selected (${n}) as CSV`, action: "copyCsv" },
      ]},
      { label: "Export", action: "export", children: [
        { label: `Selected (${n}) to file…`, action: "exportSelected" },
        { label: "All results to file…", action: "exportAll" },
      ]},
      { label: `Delete selected (${n})`, action: "deleteSelected", disabled: !allHaveId },
    ];
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { ioError = "Không copy được."; }
  }

  async function writeFile(text: string, ext: "json" | "csv") {
    const path = await saveDialog(`${srcColl ?? "results"}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (path === null) return;
    try { await writeTextFile(path, text); } catch (e) { ioError = e instanceof Error ? e.message : String(e); }
  }

  function onMenuSelect(action: string): { open: Doc } | null {
    if (!menu) return null;
    const doc = pageDocs[menu.row];
    const key = menu.key;
    const rows = effectiveRows();
    const picked = rows.map((r) => pageDocs[r]).filter(Boolean);
    switch (action) {
      case "open": menu = null; return doc ? { open: doc } : null;
      case "copyValue": copy(JSON.stringify(getByPath(doc, key))); break;
      case "copyId": copy(idJson(doc) ?? ""); break;
      case "copyJson": copy(toJsonArray(picked)); break;
      case "copyCsv": copy(toCsv(picked)); break;
      case "exportSelected": writeFile(toJsonArray(picked), "json"); break;
      case "exportAll": writeFile(toJsonArray(docs), "json"); break;
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
    if (!srcDb || !srcColl) return;
    const ids: string[] = [];
    for (const d of picked) { const id = idJson(d); if (id === null) { ioError = "Một số dòng thiếu _id."; return; } ids.push(id); }
    const filter = idInFilter(ids);
    try {
      await deleteMany(srcDb, srcColl, filter, false);
      commandLog.push(deleteManyCmd(srcColl, filter));
      docs = docs.filter((d) => { const id = idJson(d); return id === null || !ids.includes(id); });
      selected = new Set();
      anchor = null;
    } catch (e) { ioError = e instanceof Error ? e.message : String(e); }
  }

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; },
    get docs() { return docs; },
    get columns() { return columns; },
    get pageDocs() { return pageDocs; },
    get colWidths() { return colWidths; },
    get error() { return error; },
    get loading() { return loading; },
    get capped() { return capped; },
    get ran() { return ran; },
    get view() { return view; },
    set view(v: "grid" | "tree") { view = v; },
    get pageSize() { return pageSize; },
    get currentPage() { return page; },
    get pageCount() { return pgCount; },
    get totalCount() { return totalCount; },
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
    goToPage: (p: number) => { pageReq = clampPage(p, pgCount); },
    setPageSize: (n: number) => { pageSize = Math.max(1, Math.floor(n) || 50); pageReq = 1; },
    run: (db: string | null) => exec(db, false),
    runNoLimit: (db: string | null) => exec(db, true),
    runSelection,
    setSelection,
    get hasSelection() { return hasSelection; },
    get srcDb() { return srcDb; },
    get srcColl() { return srcColl; },
    get selected() { return selected; },
    clickRow,
    get menu() { return menu; },
    openMenu, closeMenu, menuItems, onMenuSelect,
    get ioError() { return ioError; },
    get confirmDelete() { return confirmDelete; },
    cancelDelete,
    confirmDeleteRun,
  };
}
