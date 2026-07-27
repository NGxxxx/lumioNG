import * as m from "$lib/paraglide/messages";
import { queryPage, sampleDocuments, fetchFullDoc, countDocuments, exportQueryProgress } from "../api/documents";
import { toJsonArray, toCsv } from "../domain/exporter";
import { errorMessage } from "../api/errors";
import { idJson } from "../domain/docid";
import { clipboardTextOf } from "../domain/extjson";
import { pageCount, clampPage, skipFor } from "../domain/paging";
import { type Doc } from "../domain/doc";
import { getByPath, inferSchema, mergeColumns, limitColumnsToDepth, type CollectionSchema, type ColumnField } from "../domain/schema";
import { isInlineEditable, isModalEditable, editTextOf } from "../domain/celledit";
import { parseFilter } from "../domain/filter";
import { matchingIndices } from "../domain/search";
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
import type { MenuItem } from "../domain/gridView";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";
import { findCmd, sampleCmd, findOneByIdCmd } from "../domain/mongosh";
import { createCollectionBulk } from "./collectionBulk.svelte";
import { createQuickSearch } from "./quickSearch.svelte";
import { createEditBlurFlow } from "./cellEditBlur.svelte";
import { createCellEditEntry } from "./cellEditEntry.svelte";
import { createShowAllFlow } from "./showAllFlow.svelte";
import { createRowSelection } from "./rowSelection.svelte";
import { createExportRequest } from "./exportRequest.svelte";
import { createDeleteFlow } from "./deleteFlow.svelte";
import { createCommitEditFlow } from "./commitEditFlow.svelte";
import { createClipboardCopy } from "./clipboardCopy";

/** State and actions for one collection view: data, paging, inline edit, context menu, and delete. */
export function createCollectionView(sessionId: string, db: string, coll: string) {
  // $state.raw (not $state): deep-proxying every doc is what made a 25k-row "Show all" balloon to >1GB; docs are always reassigned wholesale, never mutated in place.
  let docs = $state.raw<Doc[]>([]);
  let schema = $state<CollectionSchema | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let filterText = $state("");
  let filterError = $state<string | null>(null);
  let appliedFilter = $state("{}");
  let generation = 0;

  // Client-side quick search (HeidiSQL-style): filters the currently loaded page in place, no server round-trip — distinct from the real Mongo query filter above.
  const quickSearch = createQuickSearch();

  let sortKeys = $state<SortKey[]>([]);
  // Grid/Tree toggle, kept here (not in ResultTable's local state) so it survives the `#key` remount that
  // happens when switching context tabs away from and back to Data.
  let view = $state<"grid" | "tree">("grid");
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

  // Inline/modal cell edit (same factory as the Query tab's result grid).
  const edit = createCellEditEntry();

  /** Bump on every navigation/reload: in-flight loads captured the old value and bail out, and any
   *  open cell edit is dropped — `editing.row` indexes the OLD `docs`, so leaving it open would
   *  silently rebind the edit box (and the eventual $set) to whatever document lands on that row. */
  function bumpGeneration(): number {
    edit.clear();
    return ++generation;
  }

  // Row selection (indices into the current page `docs`) -- also owns the right-click context menu.
  const selection = createRowSelection({
    getDocs: () => docs,
    getVisibleIndices: () => visibleIndices,
  });

  // $state, not $derived: mergeColumns() rescans docs, but docs is reassigned on every cell edit too — recompute explicitly only when the doc set actually changes.
  let rawColumnFields = $state<ColumnField[]>([]);
  function ensureColumns() {
    rawColumnFields = mergeColumns(schema, docs);
  }
  const columnFields = $derived(limitColumnsToDepth(rawColumnFields, settings.gridMaxDepth));
  // Search only currently-visible columns (matches what the column chooser hid and what the grid actually renders), not the full unfiltered columnFields.
  const searchableColumns = $derived(columnFields.filter((c) => !hidden.has(c.path)));
  const visibleIndices = $derived(matchingIndices(docs, searchableColumns, quickSearch.appliedSearchRegex));

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
    activity.begin(m.status_bar_loading());
    try {
      const sample = await sampleDocuments(sessionId, db, coll, appliedFilter, 100, settings.queryTimeoutMs);
      if (gen !== generation) return;
      schema = inferSchema(sample);
      commandLog.push(sampleCmd(coll, 100), sessionId, Date.now() - startedAt);
    } catch {
      if (gen !== generation) return;
      schema = null; // degrade: columns fall back to row-derived
    } finally {
      activity.end();
    }
  }

  async function init() {
    const schemaP = loadSchema();
    await refreshCount();
    await loadPage();
    await schemaP;
    // loadSchema() can resolve after loadPage() already recomputed columns, so recompute once more in case schema metadata arrived late.
    ensureColumns();
    ensureColWidths();
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
        settings.queryTimeoutMs,
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
      ensureColumns();
      ensureColWidths();
      selection.clearSelection();
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
      activity.end();
    }
  }

  /** Recount documents under the active filter and clamp currentPage; every caller follows this with loadPage(), which owns clearing `loading`. */
  async function refreshCount() {
    loading = true;
    const gen = generation;
    activity.begin(m.status_bar_loading());
    try {
      const n = await countDocuments(sessionId, db, coll, appliedFilter, settings.queryTimeoutMs);
      if (gen !== generation) return;
      totalCount = n;
      currentPage = clampPage(currentPage, pageCount(totalCount, pageSize));
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      activity.end();
    }
  }

  async function goToPage(n: number) {
    const target = clampPage(n, pgCount);
    currentPage = target;
    bumpGeneration();
    await loadPage();
  }
  const nextPage = () => goToPage(currentPage + 1);
  const prevPage = () => goToPage(currentPage - 1);
  const firstPage = () => goToPage(1);
  const lastPage = () => goToPage(pgCount);

  /** Show ALL: fetch every matching doc into the grid (export_query) and hide the pager. totalCount
   *  is already kept fresh by refreshCount() on every filter/sort/mutation, so the shared flow gates
   *  off it directly instead of re-counting — avoids a redundant round-trip on click. */
  const showAll = createShowAllFlow({
    getTotalCount: () => totalCount,
    bumpGeneration,
    currentGeneration: () => generation,
    setError: (msg) => { error = msg; },
    setLoading: (v) => { loading = v; },
    activityLabel: () => m.status_bar_loading(),
    load: async (stale) => {
      const startedAt = Date.now();
      const all = await exportQueryProgress(
        sessionId,
        db,
        coll,
        appliedFilter,
        buildSort(sortKeys),
        buildProjection(hidden),
        () => {},
      );
      if (stale()) return;
      commandLog.push(
        findCmd({ coll, filter: appliedFilter, projection: buildProjection(hidden), sort: buildSort(sortKeys) }),
        sessionId,
        Date.now() - startedAt,
      );
      docs = all;
      ensureColumns();
      ensureColWidths();
      selection.clearSelection();
      allShown = true;
    },
  });

  /** In-place reload (same filter): refresh count and reload the current page (clamped). */
  async function reloadDocs() {
    bumpGeneration();
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
    bumpGeneration();
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
    bumpGeneration();
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
    bumpGeneration();
    currentPage = 1;
    await loadSchema();
    await refreshCount();
    await loadPage();
  }

  async function startEdit(row: number, key: string) {
    if (hidden.size > 0) {
      // Same guard as every other awaiting flow here: a page/filter/sort change during the re-fetch
      // makes `row` point at a different document, so drop this result instead of writing it back.
      const gen = generation;
      const fullRow = await fullDocFor(docs[row]);
      if (gen !== generation) return;
      if (fullRow !== docs[row]) {
        docs[row] = fullRow;
        docs = [...docs];
      }
    }
    edit.begin(row, key, getByPath(docs[row], key));
  }

  const editBlur = createEditBlurFlow({
    getEditing: () => edit.editing,
    isSaving: () => commitFlow.saving,
    clearEditing: () => edit.clear(),
    getEditText: () => edit.editText,
    getOriginalText: (row, key) => {
      const d = docs[row];
      return d ? editTextOf(getByPath(d, key)) : "";
    },
    commitEdit: () => commitFlow.commitEdit(),
  });
  const cancelEdit = editBlur.cancelEdit;
  const onEditBlur = editBlur.onEditBlur;
  const confirmBlurEdit = editBlur.confirmBlurEdit;
  const discardBlurEdit = editBlur.discardBlurEdit;

  const commitFlow = createCommitEditFlow({
    sessionId,
    edit,
    getDocs: () => docs,
    setDocs: (next) => { docs = next; },
    getTarget: () => ({ db, coll }),
    noIdMessage: () => m.collection_view_no_id_update(),
    currentGeneration: () => generation,
  });

  function menuItems(): MenuItem[] {
    const menu = selection.menu;
    if (!menu) return [];
    const value = getByPath(docs[menu.row], menu.key);
    const n = selection.effectiveSelectionCount();
    const hasId = idJson(docs[menu.row]) !== null;
    const items: MenuItem[] = [];
    if (n === 1) items.push({ label: m.context_menu_open_document(), action: "open" });
    if (menu.source === "tree") items.push({ label: m.context_menu_expand_full_depth(), action: "expandFullDepth" });
    items.push({ label: m.context_menu_refresh(), action: "refresh" });
    items.push({
      label: m.context_menu_edit_cell(),
      action: "editCell",
      disabled: !isInlineEditable(menu.key, value) && !isModalEditable(menu.key, value),
    });
    items.push({
      label: m.context_menu_copy(),
      action: "copy",
      children: [
        { label: m.context_menu_copy_value(), action: "copyValue" },
        { label: m.context_menu_copy_field_path(), action: "copyPath" },
        { label: m.context_menu_copy_id(), action: "copyId", disabled: !hasId },
        { label: m.context_menu_copy_selected_json({ count: n }), action: "copyJson" },
        { label: m.context_menu_copy_selected_csv({ count: n }), action: "copyCsv" },
      ],
    });
    items.push({
      label: m.context_menu_export(),
      action: "export",
      children: [
        { label: m.context_menu_export_selected({ count: n }), action: "exportSelected" },
        { label: m.context_menu_export_all_filter(), action: "exportFilter" },
      ],
    });
    items.push({
      label: m.context_menu_update(),
      action: "update",
      children: [
        { label: m.context_menu_update_selected({ count: n }), action: "updateSelected" },
        { label: m.context_menu_update_all_filter(), action: "updateAll" },
      ],
    });
    items.push({
      label: m.context_menu_delete(),
      action: "delete",
      children: [
        { label: m.context_menu_delete_selected({ count: n }), action: "deleteSelected" },
        { label: m.context_menu_delete_all_filter(), action: "deleteAll" },
      ],
    });
    items.push(
      { label: m.context_menu_new_document(), action: "newDoc" },
      { label: m.context_menu_duplicate_document(), action: "duplicate", disabled: n !== 1 },
    );
    return items;
  }

  function newDocument(): Doc {
    return buildSkeleton(rawColumnFields);
  }

  function duplicateSelected(): Doc | null {
    const rows = [...selection.selected];
    if (rows.length !== 1) return null;
    const doc = docs[rows[0]];
    return doc ? duplicateForInsert(doc) : null;
  }

  const copy = createClipboardCopy((msg) => { error = msg; });

  /** Returns the doc to open for "open", `{ insert }` (a pre-built skeleton/duplicate) for New/Duplicate,
   *  or `{ expandFullDepth }` (a tree doc index) for the Tree view's "Expand full depth". */
  function onMenuSelect(action: string): { open: Doc } | { insert: Doc } | { expandFullDepth: number } | null {
    const menu = selection.menu;
    if (!menu) return null;
    const row = menu.row;
    const key = menu.key;
    const doc = docs[row];
    // closeMenu() is called AFTER the switch so effectiveRows() (used by requestExport/copySelectedAs) can still read menu.row.
    switch (action) {
      case "open":
        selection.closeMenu();
        return { open: doc };
      case "expandFullDepth":
        selection.closeMenu();
        return { expandFullDepth: row };
      case "refresh":
        reloadDocs();
        break;
      case "copyValue":
        copy(clipboardTextOf(getByPath(doc, key)));
        break;
      case "copyPath":
        copy(key);
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
        exportFlow.requestExport("selection");
        break;
      case "exportFilter":
        exportFlow.requestExport("filter");
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
        selection.closeMenu();
        return { insert: newDocument() };
      case "duplicate": {
        const dup = doc ? duplicateForInsert(doc) : null;
        selection.closeMenu();
        return dup ? { insert: dup } : null;
      }
      case "editCell":
        startEdit(row, key);
        break;
    }
    selection.closeMenu();
    return null;
  }

  const bulk = createCollectionBulk({
    sessionId, db, coll,
    getAppliedFilter: () => appliedFilter,
    getSelectedIds: selection.selectedIds,
    reload: reloadDocs,
  });

  const exportFlow = createExportRequest({
    db, coll,
    getEffectiveIds: selection.effectiveIds,
    getEffectiveSelectionCount: selection.effectiveSelectionCount,
    getAppliedFilter: () => appliedFilter,
    getSortKeys: () => sortKeys,
    getRawColumnFields: () => rawColumnFields,
    getHidden: () => hidden,
  });

  const deleteFlow = createDeleteFlow({
    sessionId, db, coll,
    getSelectedIds: selection.selectedIds,
    setError: (msg) => { error = msg; },
    setLoading: (v) => { loading = v; },
    reload: reloadDocs,
  });

  /** Wraps deleteFlow's count-based confirm so the context menu / toolbar can call it with no args. */
  function requestDeleteSelected() {
    deleteFlow.requestDeleteSelected(selection.selectedCount);
  }

  async function copySelectedAs(format: "json" | "csv") {
    const rows = selection.effectiveRows();
    const picked = rows.map((r) => docs[r]).filter(Boolean);
    const text = format === "json" ? toJsonArray(picked) : toCsv(picked);
    await copy(text);
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
    get showAllPending() { return showAll.showAllPending; },
    requestShowAll: showAll.requestShowAll,
    confirmShowAll: showAll.confirmShowAll,
    cancelShowAll: showAll.cancelShowAll,
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
    get searchTerm() {
      return quickSearch.searchTerm;
    },
    set searchTerm(v: string) {
      quickSearch.searchTerm = v;
    },
    get searchInvalid() {
      return quickSearch.searchInvalid;
    },
    get visibleIndices() {
      return visibleIndices;
    },
    get confirmDoc() {
      return deleteFlow.confirmDoc;
    },
    get editing() {
      return edit.editing;
    },
    get editText() {
      return edit.editText;
    },
    set editText(v: string) {
      edit.editText = v;
    },
    get editTextLoading() {
      return edit.editTextLoading;
    },
    get editError() {
      return edit.editError;
    },
    get editBlurPending() { return editBlur.editBlurPending; },
    onEditBlur,
    confirmBlurEdit,
    discardBlurEdit,
    get saving() {
      return commitFlow.saving;
    },
    get menu() {
      return selection.menu;
    },
    get selected() { return selection.selected; },
    get selectedCount() { return selection.selectedCount; },
    get confirmSelectionDelete() { return deleteFlow.confirmSelectionDelete; },
    clickRow: selection.clickRow,
    selectAll: selection.selectAll,
    invertSelection: selection.invertSelection,
    clearSelection: selection.clearSelection,
    selectedIds: selection.selectedIds,
    requestDeleteSelected,
    cancelDeleteSelected: deleteFlow.cancelDeleteSelected,
    confirmDeleteSelected: deleteFlow.confirmDeleteSelected,
    get sortKeys() {
      return sortKeys;
    },
    get view() {
      return view;
    },
    set view(v: "grid" | "tree") {
      view = v;
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
    commitEdit: commitFlow.commitEdit,
    openMenu: selection.openMenu,
    closeMenu: selection.closeMenu,
    menuItems,
    onMenuSelect,
    requestDelete: deleteFlow.requestDelete,
    cancelDelete: deleteFlow.cancelDelete,
    confirmDelete: deleteFlow.confirmDelete,
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
    get ioError() { return exportFlow.ioError; },
    get exportRequest() { return exportFlow.exportRequest; },
    requestExport: exportFlow.requestExport,
    cancelExport: exportFlow.cancelExport,
    exportInput: exportFlow.exportInput,
    effectiveSelectionCount: selection.effectiveSelectionCount,
    copySelectedAs,
    newDocument,
    duplicateSelected,
  };
}
