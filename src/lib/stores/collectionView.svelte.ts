import * as m from "$lib/paraglide/messages";
import { queryPage, sampleDocuments, deleteDocument, updateOne, fetchFullDoc, countDocuments, deleteMany, exportQueryProgress } from "../api/documents";
import type { ExportWizardInput } from "../domain/exportPlan";
import { toJsonArray, toCsv } from "../domain/exporter";
import { errorMessage } from "../api/errors";
import { idJson } from "../domain/docid";
import { describeValue } from "../domain/extjson";
import { pageCount, clampPage, skipFor } from "../domain/paging";
import { rangeBetween, idInFilter, resolveIds, effectiveRows as effectiveRowsOf } from "../domain/selection";
import { type Doc } from "../domain/doc";
import { getByPath, inferSchema, mergeColumns, type CollectionSchema, type ColumnField } from "../domain/schema";
import { isInlineEditable, editTextOf, rebuildValue, setByPath, buildSetUpdate } from "../domain/celledit";
import { parseFilter } from "../domain/filter";
import {
  cycleSort,
  buildSort,
  buildProjection,
  addSortKey,
  toggleSortDir,
  removeSortKey,
  moveSortKey,
  type SortKey,
} from "../domain/grid";
import { buildSkeleton, duplicateForInsert } from "../domain/skeleton";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import type { MenuItem } from "../components/ContextMenu.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { findCmd, updateOneCmd, deleteOneCmd, deleteManyCmd, sampleCmd, findOneByIdCmd } from "../domain/mongosh";
import { createCollectionBulk } from "./collectionBulk.svelte";

/**
 * State and actions for one collection view: data, paging, inline edit,
 * context menu, and delete. Components only render and bind; no logic here.
 */
export function createCollectionView(sessionId: string, db: string, coll: string) {
  // $state.raw (not $state): docs are always replaced wholesale (loadPage/showAll/filter
  // assign a fresh array; inline edits mutate then reassign `[...docs]`). Deep-proxying every
  // doc here is what made a 25k-row "Show all" balloon to >1GB — each nested field became a
  // Svelte signal/proxy. Raw keeps them plain objects; reassignment still drives reactivity.
  let docs = $state.raw<Doc[]>([]);
  let schema = $state<CollectionSchema | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let filterText = $state("");
  let filterError = $state<string | null>(null);
  let appliedFilter = $state("{}");
  let generation = 0;

  let sortKeys = $state<SortKey[]>([]);
  let hidden = $state<Set<string>>(new Set());
  let hiddenDraft = $state<Set<string>>(new Set());
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});
  let colWidthSig = "";
  let pageSize = $state(50);
  let currentPage = $state(1);
  let totalCount = $state(0);
  const pgCount = $derived(pageCount(totalCount, pageSize));

  let allShown = $state(false);
  let showAllPending = $state<number | null>(null);
  const SHOW_ALL_WARN_THRESHOLD = 5000;

  let confirmDoc = $state<Doc | null>(null);

  // Inline cell edit
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Context menu
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);

  // Row selection (indices into the current page `docs`)
  let selected = $state<Set<number>>(new Set());
  let anchor = $state<number | null>(null);
  const selectedCount = $derived(selected.size);
  let confirmSelectionDelete = $state<number | null>(null);

  // Export / import I/O
  let ioError = $state<string | null>(null);
  let exportRequest = $state<{ kind: "filter" } | { kind: "selection"; count: number } | null>(null);
  let pendingExportFilter: string | null = "{}";

  const columnFields = $derived(mergeColumns(schema, docs));

  /** Compute default widths once per column-set; recompute only when the paths change. */
  function ensureColWidths() {
    const sig = columnFields.map((c) => c.path).join("|");
    if (sig === colWidthSig) return;
    colWidthSig = sig;
    defaultColWidths = computeColumnWidths(columnFields, docs);
    colWidths = { ...defaultColWidths };
  }

  function setColWidth(path: string, px: number) {
    colWidths = { ...colWidths, [path]: clampWidth(px) };
  }

  function resetColWidth(path: string) {
    if (defaultColWidths[path] === undefined) return;
    colWidths = { ...colWidths, [path]: defaultColWidths[path] };
  }

  async function loadSchema() {
    const gen = generation;
    const startedAt = Date.now();
    try {
      const sample = await sampleDocuments(sessionId, db, coll, appliedFilter, 100);
      if (gen !== generation) return;
      schema = inferSchema(sample);
      commandLog.push(sampleCmd(coll, 100), sessionId, Date.now() - startedAt);
    } catch {
      if (gen !== generation) return;
      schema = null; // degrade: columns fall back to row-derived
    }
  }

  async function init() {
    const schemaP = loadSchema();
    await refreshCount();
    await loadPage();
    await schemaP;
  }

  /** Load the current page (replaces docs). */
  async function loadPage() {
    loading = true;
    allShown = false;
    error = null;
    const gen = generation;
    const startedAt = Date.now();
    activity.begin(m.status_bar_loading());
    try {
      const skip = skipFor(currentPage, pageSize);
      const batch = await queryPage(
        sessionId,
        db,
        coll,
        skip,
        pageSize,
        appliedFilter,
        buildSort(sortKeys),
        buildProjection(hidden),
      );
      if (gen !== generation) return;
      commandLog.push(
        findCmd({
          coll,
          filter: appliedFilter,
          projection: buildProjection(hidden),
          sort: buildSort(sortKeys),
          skip,
          limit: pageSize,
        }),
        sessionId,
        Date.now() - startedAt,
      );
      docs = batch;
      ensureColWidths();
      clearSelection();
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
      activity.end();
    }
  }

  /** Recount documents under the active filter and clamp currentPage to the valid range. */
  async function refreshCount() {
    const gen = generation;
    try {
      const n = await countDocuments(sessionId, db, coll, appliedFilter);
      if (gen !== generation) return;
      totalCount = n;
      currentPage = clampPage(currentPage, pageCount(totalCount, pageSize));
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    }
  }

  async function goToPage(n: number) {
    const target = clampPage(n, pgCount);
    currentPage = target;
    generation++;
    await loadPage();
  }
  const nextPage = () => goToPage(currentPage + 1);
  const prevPage = () => goToPage(currentPage - 1);
  const firstPage = () => goToPage(1);
  const lastPage = () => goToPage(pgCount);

  /** Show ALL: totalCount is already kept fresh by refreshCount() on every filter/sort/mutation,
   *  so gate off it directly instead of re-counting — avoids a redundant round-trip on click. */
  function requestShowAll(): void | Promise<void> {
    error = null;
    if (totalCount > SHOW_ALL_WARN_THRESHOLD) {
      generation++; // invalidate any other in-flight load — this supersedes it
      showAllPending = totalCount;
      return;
    }
    return confirmShowAll();
  }

  /** Fetch all matching docs into the grid (export_query); hides the pager. Self-guarding: bumps
   *  `generation` so a second call (or any other in-flight load) discards a stale first call. */
  async function confirmShowAll() {
    showAllPending = null;
    loading = true;
    error = null;
    generation++;
    const gen = generation;
    const startedAt = Date.now();
    activity.begin(m.status_bar_loading());
    try {
      const all = await exportQueryProgress(
        sessionId,
        db,
        coll,
        appliedFilter,
        buildSort(sortKeys),
        buildProjection(hidden),
        () => {},
      );
      if (gen !== generation) return;
      commandLog.push(
        findCmd({ coll, filter: appliedFilter, projection: buildProjection(hidden), sort: buildSort(sortKeys) }),
        sessionId,
        Date.now() - startedAt,
      );
      docs = all;
      ensureColWidths();
      clearSelection();
      allShown = true;
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
      activity.end();
    }
  }

  function cancelShowAll() {
    showAllPending = null;
  }

  /** In-place reload (same filter): refresh count and reload the current page (clamped). */
  async function reloadDocs() {
    generation++;
    await refreshCount();
    await loadPage();
  }

  /** Sync the draft to the currently applied state (call when opening the column chooser). */
  function resetProjectionDraft() {
    hiddenDraft = new Set(hidden);
  }

  function toggleHiddenDraft(path: string) {
    const next = new Set(hiddenDraft);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    hiddenDraft = next;
  }

  /** Commit draft → live projection and reload. */
  async function applyProjection() {
    hidden = new Set(hiddenDraft);
    await reloadDocs();
  }

  /** Returns the full document; re-fetches only when a projection is active. */
  async function fullDocFor(d: Doc): Promise<Doc> {
    if (hidden.size === 0) return d;
    const id = idJson(d);
    if (id === null) return d;
    const full = await commandLog.pushTimed(findOneByIdCmd(coll, id), sessionId, () =>
      fetchFullDoc(sessionId, db, coll, id));
    return full ?? d;
  }

  /** Full document for opening an edit tab (component handles the actual open). */
  async function openDoc(d: Doc): Promise<Doc> {
    return await fullDocFor(d);
  }

  /** Apply a new sortKeys set: reset to page 1 and reload (shared by header-click and dropdown). */
  async function applySortChange(next: SortKey[]) {
    sortKeys = next;
    generation++;
    currentPage = 1;
    await refreshCount();
    await loadPage();
  }

  const toggleSort = (path: string, shift: boolean) =>
    applySortChange(cycleSort(sortKeys, path, shift));
  const addSort = (path: string) => applySortChange(addSortKey(sortKeys, path));
  const toggleSortDirAt = (path: string) => applySortChange(toggleSortDir(sortKeys, path));
  const removeSort = (path: string) => applySortChange(removeSortKey(sortKeys, path));
  const moveSort = (path: string, delta: number) =>
    applySortChange(moveSortKey(sortKeys, path, delta));
  const clearSort = () => applySortChange([]);

  /** Show all fields (clear the hidden draft). */
  function showAllFieldsDraft() {
    hiddenDraft = new Set();
  }

  /** Hide all fields except _id (buildProjection never excludes _id). */
  function hideAllFieldsDraft() {
    hiddenDraft = new Set(columnFields.map((c) => c.path).filter((p) => p !== "_id"));
  }

  async function setPageSize(n: number) {
    pageSize = Math.max(1, Math.floor(n) || 50);
    generation++;
    currentPage = 1;
    await loadPage();
  }

  async function applyFilter() {
    const r = parseFilter(filterText);
    if (!r.ok) {
      filterError = r.error;
      return;
    }
    appliedFilter = r.json;
    filterError = null;
    schema = null;
    generation++;
    currentPage = 1;
    await loadSchema();
    await refreshCount();
    await loadPage();
  }

  async function startEdit(row: number, key: string) {
    if (hidden.size > 0) {
      const fullRow = await fullDocFor(docs[row]);
      if (fullRow !== docs[row]) {
        docs[row] = fullRow;
        docs = [...docs];
      }
    }
    const value = getByPath(docs[row], key);
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

  let editBlurPending = $state(false);

  /** Blur (click elsewhere) discards silently when nothing changed; otherwise asks for
   *  confirmation before saving (Enter still saves immediately, no confirmation). */
  function onEditBlur() {
    if (!editing || saving) return;
    const original = editTextOf(getByPath(docs[editing.row], editing.key));
    if (editText === original) cancelEdit();
    else editBlurPending = true;
  }

  async function confirmBlurEdit() {
    editBlurPending = false;
    await commitEdit();
  }

  function discardBlurEdit() {
    editBlurPending = false;
    cancelEdit();
  }

  async function commitEdit() {
    if (!editing || saving) return;
    const { row, key } = editing;
    const r = rebuildValue(getByPath(docs[row], key), editText);
    if (!r.ok) {
      editError = r.error;
      return;
    }
    const id = idJson(docs[row]);
    if (id === null) {
      editError = m.collection_view_no_id_update();
      return;
    }
    // $set only the touched path — a full replaceDocument would re-send every other field too,
    // including any huge untouched sibling (e.g. a multi-MB value), which is what made editing
    // one small cell serialize + transmit the entire document.
    const filter = `{"_id": ${id}}`;
    const update = buildSetUpdate(key, r.value);
    saving = true;
    try {
      await commandLog.pushTimed(updateOneCmd(coll, filter, update), sessionId, () =>
        updateOne(sessionId, db, coll, filter, update, false));
      docs[row] = setByPath(docs[row], key, r.value);
      docs = [...docs];
      editing = null;
      editError = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  function openMenu(e: MouseEvent, row: number, key: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!selected.has(row)) {
      selected = new Set([row]);
      anchor = row;
    }
    menu = { x: e.clientX, y: e.clientY, row, key };
  }

  function closeMenu() {
    menu = null;
  }

  function clickRow(row: number, mods: { ctrl: boolean; shift: boolean }) {
    if (mods.shift && anchor !== null) {
      selected = new Set(rangeBetween(anchor, row));
      return;
    }
    if (mods.ctrl) {
      const next = new Set(selected);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      selected = next;
      anchor = row;
      return;
    }
    selected = new Set([row]);
    anchor = row;
  }

  function selectAll() {
    selected = new Set(docs.map((_, i) => i));
    anchor = docs.length > 0 ? 0 : null;
  }

  function clearSelection() {
    selected = new Set();
    anchor = null;
  }

  /** Resolve selected rows to id ExtJSON; reports `missing` if any lacks _id. */
  function selectedIds(): { ids: string[] } | { missing: true } {
    return resolveIds(docs, selected);
  }

  /** Effective selection for right-click: the multi-select if the menu row is in it, else the menu row alone. */
  function effectiveRows(): number[] {
    return effectiveRowsOf(menu ? menu.row : null, selected);
  }
  function effectiveSelectionCount(): number {
    return effectiveRows().length;
  }
  function effectiveIds(): { ids: string[] } | { missing: true } {
    return resolveIds(docs, effectiveRows());
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const value = getByPath(docs[menu.row], menu.key);
    const n = effectiveSelectionCount();
    const hasId = idJson(docs[menu.row]) !== null;
    const items: MenuItem[] = [];
    if (n === 1) items.push({ label: "Open document", action: "open" });
    items.push({
      label: "Edit cell",
      action: "editCell",
      disabled: !isInlineEditable(menu.key, value),
    });
    items.push({
      label: "Copy",
      action: "copy",
      children: [
        { label: "Value", action: "copyValue" },
        { label: "_id", action: "copyId", disabled: !hasId },
        { label: `Selected (${n}) as JSON`, action: "copyJson" },
        { label: `Selected (${n}) as CSV`, action: "copyCsv" },
      ],
    });
    items.push({
      label: "Export",
      action: "export",
      children: [
        { label: `Selected (${n}) to file…`, action: "exportSelected" },
        { label: "All matching filter to file…", action: "exportFilter" },
      ],
    });
    items.push({
      label: "Update",
      action: "update",
      children: [
        { label: `Selected (${n})…`, action: "updateSelected" },
        { label: "All matching filter…", action: "updateAll" },
      ],
    });
    items.push({
      label: "Delete",
      action: "delete",
      children: [
        { label: `Selected (${n})`, action: "deleteSelected" },
        { label: "All matching filter…", action: "deleteAll" },
      ],
    });
    items.push(
      { label: "New document…", action: "newDoc" },
      { label: "Duplicate document…", action: "duplicate", disabled: n !== 1 },
    );
    return items;
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      error = m.common_clipboard_failed();
    }
  }

  /**
   * Returns the doc to open for "open", or `{ insert }` (with a pre-built doc) for New/Duplicate.
   * New document → skeleton with all schema fields; Duplicate → copy of the doc without _id.
   */
  function onMenuSelect(action: string): { open: Doc } | { insert: Doc } | null {
    if (!menu) return null;
    const row = menu.row;
    const key = menu.key;
    const doc = docs[row];
    // NOTE: menu = null is set AFTER the switch so that effectiveRows() (used by
    // requestExport/copySelectedAs) can still read menu.row for effective-selection logic.
    switch (action) {
      case "open":
        menu = null;
        return { open: doc };
      case "copyValue":
        copy(describeValue(getByPath(doc, key)).display);
        break;
      case "copyId":
        copy(idJson(doc) ?? "");
        break;
      case "copyJson":
        copySelectedAs("json");
        break;
      case "copyCsv":
        copySelectedAs("csv");
        break;
      case "exportSelected":
        requestExport("selection");
        break;
      case "exportFilter":
        requestExport("filter");
        break;
      case "updateSelected":
        bulk.openBulk("update", "selection");
        break;
      case "deleteSelected":
        requestDeleteSelected();
        break;
      case "updateAll":
        bulk.openBulk("update", "filter");
        break;
      case "deleteAll":
        bulk.openBulk("delete", "filter");
        break;
      case "newDoc":
        menu = null;
        return { insert: buildSkeleton(columnFields) };
      case "duplicate": {
        const dup = doc ? duplicateForInsert(doc) : null;
        menu = null;
        return dup ? { insert: dup } : null;
      }
      case "editCell":
        startEdit(row, key);
        break;
    }
    menu = null;
    return null;
  }

  const bulk = createCollectionBulk({
    sessionId, db, coll,
    getAppliedFilter: () => appliedFilter,
    getSelectedIds: selectedIds,
    reload: reloadDocs,
  });

  function requestExport(scope: "filter" | "selection") {
    if (scope === "selection") {
      const sel = effectiveIds();
      if ("missing" in sel) { ioError = m.collection_view_selection_missing_id(); return; }
      pendingExportFilter = idInFilter(sel.ids);
      exportRequest = { kind: "selection", count: effectiveSelectionCount() };
    } else {
      pendingExportFilter = appliedFilter;
      exportRequest = { kind: "filter" };
    }
  }
  function cancelExport() { exportRequest = null; pendingExportFilter = "{}"; }

  function exportInput(): ExportWizardInput | null {
    const req = exportRequest;
    if (!req || pendingExportFilter === null) return null; // defensive; requestExport guards the real case
    const columns = columnFields.map((c) => ({ path: c.path, visible: !hidden.has(c.path) }));
    const filter = pendingExportFilter;
    const sort = req.kind === "filter" ? buildSort(sortKeys) : null;
    const summary = req.kind === "selection"
      ? (req.count === 1
          ? m.export_dialog_summary_selection_one({ count: req.count })
          : m.export_dialog_summary_selection_many({ count: req.count }))
      : m.export_dialog_summary_filter();
    return { mode: "scopedCollection", db, coll, filter, sort, columns, summary };
  }

  async function copySelectedAs(format: "json" | "csv") {
    const rows = effectiveRows();
    const picked = rows.map((r) => docs[r]).filter(Boolean);
    const text = format === "json" ? toJsonArray(picked) : toCsv(picked);
    await copy(text);
  }

  function requestDeleteSelected() {
    if (selected.size === 0) return;
    confirmSelectionDelete = selected.size;
  }

  function cancelDeleteSelected() {
    confirmSelectionDelete = null;
  }

  async function confirmDeleteSelected() {
    confirmSelectionDelete = null;
    const sel = selectedIds();
    if ("missing" in sel) {
      error = m.collection_view_selection_missing_id_delete();
      return;
    }
    const filter = idInFilter(sel.ids);
    try {
      await commandLog.pushTimed(deleteManyCmd(coll, filter), sessionId, () =>
        deleteMany(sessionId, db, coll, filter, false));
      await reloadDocs(); // reloadDocs → loadPage → clearSelection
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function requestDelete(doc: Doc) {
    confirmDoc = doc;
  }

  function cancelDelete() {
    confirmDoc = null;
  }

  async function confirmDelete() {
    const d = confirmDoc;
    confirmDoc = null;
    if (!d) return;
    const id = idJson(d);
    if (id === null) {
      error = m.collection_view_no_id_delete();
      return;
    }
    try {
      await commandLog.pushTimed(deleteOneCmd(coll, id), sessionId, () =>
        deleteDocument(sessionId, db, coll, id));
      await reloadDocs();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  return {
    get docs() {
      return docs;
    },
    get schema() {
      return schema;
    },
    get columnFields() {
      return columnFields;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get currentPage() { return currentPage; },
    get pageCount() { return pgCount; },
    get totalCount() { return totalCount; },
    get allShown() { return allShown; },
    get showAllPending() { return showAllPending; },
    requestShowAll,
    confirmShowAll,
    cancelShowAll,
    get filterText() {
      return filterText;
    },
    set filterText(v: string) {
      filterText = v;
    },
    get filterError() {
      return filterError;
    },
    applyFilter,
    get confirmDoc() {
      return confirmDoc;
    },
    get editing() {
      return editing;
    },
    get editText() {
      return editText;
    },
    set editText(v: string) {
      editText = v;
    },
    get editError() {
      return editError;
    },
    get editBlurPending() { return editBlurPending; },
    onEditBlur,
    confirmBlurEdit,
    discardBlurEdit,
    get saving() {
      return saving;
    },
    get menu() {
      return menu;
    },
    get selected() { return selected; },
    get selectedCount() { return selectedCount; },
    get confirmSelectionDelete() { return confirmSelectionDelete; },
    clickRow,
    selectAll,
    clearSelection,
    selectedIds,
    requestDeleteSelected,
    cancelDeleteSelected,
    confirmDeleteSelected,
    get sortKeys() {
      return sortKeys;
    },
    get hidden() {
      return hidden;
    },
    get hiddenDraft() {
      return hiddenDraft;
    },
    get colWidths() {
      return colWidths;
    },
    setColWidth,
    resetColWidth,
    get pageSize() {
      return pageSize;
    },
    toggleSort,
    addSort,
    toggleSortDirAt,
    removeSort,
    moveSort,
    clearSort,
    showAllFieldsDraft,
    hideAllFieldsDraft,
    setPageSize,
    goToPage,
    nextPage,
    prevPage,
    firstPage,
    lastPage,
    toggleHiddenDraft,
    applyProjection,
    resetProjectionDraft,
    openDoc,
    init,
    startEdit,
    cancelEdit,
    commitEdit,
    openMenu,
    closeMenu,
    menuItems,
    onMenuSelect,
    requestDelete,
    cancelDelete,
    confirmDelete,
    copy,
    get appliedFilter() { return appliedFilter; },
    get bulkMode() { return bulk.bulkMode; },
    get bulkUpdateText() { return bulk.bulkUpdateText; },
    set bulkUpdateText(v: string) { bulk.bulkUpdateText = v; },
    get bulkUpdateError() { return bulk.bulkUpdateError; },
    get bulkCount() { return bulk.bulkCount; },
    get bulkCounting() { return bulk.bulkCounting; },
    get bulkRunning() { return bulk.bulkRunning; },
    get bulkScope() { return bulk.bulkScope; },
    get bulkTypeConfirm() { return bulk.bulkTypeConfirm; },
    confirmBulkAll: bulk.confirmBulkAll,
    cancelBulkAll: bulk.cancelBulkAll,
    get bulkResult() { return bulk.bulkResult; },
    get bulkError() { return bulk.bulkError; },
    get canRunBulk() { return bulk.canRunBulk; },
    openBulk: bulk.openBulk,
    closeBulk: bulk.closeBulk,
    countBulk: bulk.countBulk,
    runBulk: bulk.runBulk,
    get ioError() { return ioError; },
    get exportRequest() { return exportRequest; },
    requestExport,
    cancelExport,
    exportInput,
    effectiveSelectionCount,
    copySelectedAs,
  };
}
