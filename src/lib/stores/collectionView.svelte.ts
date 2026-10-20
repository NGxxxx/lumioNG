import * as m from "#lib/paraglide/messages.js";
import { sampleDocuments, fetchFullDoc, exportQueryProgress } from "../api/documents";
import { overlayPending } from "../domain/pendingEdits";
import { pendingEdits } from "./pendingEdits.svelte";
import { toJsonArray, toCsv } from "../domain/exporter";
import { idJson } from "../domain/docid";
import { type Doc } from "../domain/doc";
import { inferSchema, mergeColumns, limitColumnsToDepth, type CollectionSchema, type ColumnField } from "../domain/schema";
import { buildSort, buildProjection } from "../domain/grid";
import { buildSkeleton, duplicateForInsert } from "../domain/skeleton";
import { matchingIndices } from "../domain/search";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";
import { findCmd, sampleCmd, findOneByIdCmd } from "../domain/mongosh";
import { createCollectionBulk } from "./collectionBulk.svelte";
import { createQuickSearch } from "./quickSearch.svelte";
import { createShowAllFlow } from "./showAllFlow.svelte";
import { createRowSelection } from "./rowSelection.svelte";
import { createExportRequest } from "./exportRequest.svelte";
import { createDeleteFlow } from "./deleteFlow.svelte";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { fieldInfos as buildFieldInfos, distinctValueTexts, indexedLeadingFields, type FieldInfo } from "../domain/fieldInfo";
import { listIndexes } from "../api/indexes";
import { filterHistory as filterHistoryStore } from "./filterHistory.svelte";
import { createClipboardCopy } from "./clipboardCopy";
import { createCollectionLayout } from "./collectionLayout.svelte";
import { createCollectionPaging } from "./collectionPaging.svelte";
import { createCollectionFilter } from "./collectionFilter.svelte";
import { createCollectionEdits } from "./collectionEdits.svelte";
import { createCollectionMenu } from "./collectionMenu.svelte";

/** State and actions for one collection view: data, paging, inline edit, context menu, and delete. */
export function createCollectionView(sessionId: string, db: string, coll: string) {
  // $state.raw (not $state): deep-proxying every doc is what made a 25k-row "Show all" balloon to >1GB; docs are always reassigned wholesale, never mutated in place.
  let docs = $state.raw<Doc[]>([]);
  let schema = $state<CollectionSchema | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let generation = 0;

  // Client-side quick search (HeidiSQL-style): filters the currently loaded page in place, no server round-trip — distinct from the real Mongo query filter.
  const quickSearch = createQuickSearch();

  /** Bump on every navigation/reload: in-flight loads captured the old value and bail out, and any
   *  open cell edit is dropped — `editing.row` indexes the OLD `docs`, so leaving it open would
   *  silently rebind the edit box (and the eventual $set) to whatever document lands on that row. */
  // Reactive mirror of `generation` for the grid (cursor reset); plain `generation` stays the race guard.
  let loadCount = $state(0);
  function bumpGeneration(): number {
    edits.edit.clear();
    loadCount++;
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

  // Sort / column visibility / widths / Grid-Tree mode, restored from the remembered layout at construction.
  const layoutKey = `${sessionId}/${db}/${coll}`;
  const layout = createCollectionLayout({
    layoutKey,
    getDocs: () => docs,
    getColumnFields: () => columnFields,
    bumpGeneration,
    loadFirstPage: () => paging.loadFirstPage(),
    reloadDocs: () => reloadDocs(),
    filterBy: (path, op, value) => filter.filterBy(path, op, value),
    copy: (text) => copy(text),
  });

  const paging = createCollectionPaging({
    sessionId, db, coll,
    getAppliedFilter: () => filter.appliedFilter,
    getSortKeys: () => layout.sortKeys,
    getHidden: () => layout.hidden,
    currentGeneration: () => generation,
    bumpGeneration,
    setLoading: (v) => { loading = v; },
    setError: (msg) => { error = msg; },
    applyDocs,
  });

  const filter = createCollectionFilter({
    layoutKey,
    layout,
    clearSchema: () => { schema = null; },
    loadSchema: () => loadSchema(),
    bumpGeneration,
    loadFirstPage: () => paging.loadFirstPage(),
  });

  const edits = createCollectionEdits({
    sessionId, db, coll,
    getDocs: () => docs,
    setDocs: (next) => { docs = next; },
    currentGeneration: () => generation,
    hasHidden: () => layout.hidden.size > 0,
    fullDocFor: (d) => fullDocFor(d),
    setError: (msg) => { error = msg; },
    reloadDocs: () => reloadDocs(),
  });
  const pending = edits.pending;

  // ── Filter chips field hints (spec §2) ──
  const SLOW_FIELD_MIN_DOCS = 100_000;
  let indexedFields = $state.raw<Set<string>>(new Set());
  const fieldInfoList = $derived<FieldInfo[]>(buildFieldInfos(rawColumnFields, indexedFields));

  async function loadIndexedFields() {
    try {
      indexedFields = indexedLeadingFields(await listIndexes(sessionId, db, coll));
    } catch {
      // hints only — no index list, no "may be slow" dots
    }
  }

  // Search only currently-visible columns (matches what the column chooser hid and what the grid actually renders), not the full unfiltered columnFields.
  const searchableColumns = $derived(columnFields.filter((c) => !layout.hidden.has(c.path)));
  const visibleIndices = $derived(matchingIndices(docs, searchableColumns, quickSearch.appliedSearchRegex));

  async function loadSchema() {
    const gen = generation;
    const startedAt = Date.now();
    activity.begin(m.status_bar_loading());
    try {
      const sample = await sampleDocuments(sessionId, db, coll, filter.appliedFilter, 100, settings.queryTimeoutMs);
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
    void loadIndexedFields();
    const schemaP = loadSchema();
    await paging.loadFirstPage();
    await schemaP;
    // loadSchema() can resolve after loadPage() already recomputed columns, so recompute once more in case schema metadata arrived late.
    ensureColumns();
    layout.ensureColWidths();
  }

  /** Installs a freshly loaded set of docs (staged edits overlaid) and refreshes columns, widths and selection. */
  function applyDocs(batch: Doc[]) {
    docs = overlayPending(batch, pending());
    ensureColumns();
    layout.ensureColWidths();
    selection.clearSelection();
  }

  /** Show ALL: fetch every matching doc into the grid (export_query) and hide the pager. totalCount
   *  is already kept fresh by refreshCount() on every filter/sort/mutation, so the shared flow gates
   *  off it directly instead of re-counting — avoids a redundant round-trip on click. */
  const showAll = createShowAllFlow({
    getTotalCount: () => paging.totalCount,
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
        filter.appliedFilter,
        buildSort(layout.sortKeys),
        buildProjection(layout.hidden),
        () => {},
      );
      if (stale()) return;
      paging.lastQueryMs = Date.now() - startedAt;
      commandLog.push(
        findCmd({ coll, filter: filter.appliedFilter, projection: buildProjection(layout.hidden), sort: buildSort(layout.sortKeys) }),
        sessionId,
        paging.lastQueryMs,
      );
      applyDocs(all);
      paging.allShown = true;
    },
  });

  /** In-place reload (same filter): refresh count and reload the current page (clamped). */
  async function reloadDocs() {
    bumpGeneration();
    await paging.refreshCount();
    await paging.loadPage();
  }

  /** Returns the full document; re-fetches only when a projection is active. */
  async function fullDocFor(d: Doc): Promise<Doc> {
    if (layout.hidden.size === 0) return d;
    const id = idJson(d);
    if (id === null) return d;
    const full = await commandLog.pushTimed(findOneByIdCmd(coll, id), sessionId, () =>
      fetchFullDoc(sessionId, db, coll, id));
    return full ? overlayPending([full], pending())[0] : d;
  }

  /** Full document for opening an edit tab (component handles the actual open). */
  const openDoc = (d: Doc): Promise<Doc> => fullDocFor(d);

  /** Replaces the page row holding the same `_id` (after a save elsewhere, e.g. the quick-look drawer). */
  function replaceDoc(saved: Doc) {
    const id = idJson(saved);
    if (id === null) return;
    const i = docs.findIndex((d) => idJson(d) === id);
    if (i === -1) return;
    docs[i] = overlayPending([saved], pending())[0];
    docs = [...docs];
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
  // One pending destructive operation per view (single / selection / bulk deletes and updates).
  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  const bulk = createCollectionBulk({
    sessionId, db, coll, gate: destructive,
    getAppliedFilter: () => filter.appliedFilter,
    getSelectedIds: selection.selectedIds,
    reload: reloadDocs,
  });

  const exportFlow = createExportRequest({
    db, coll,
    getEffectiveIds: selection.effectiveIds,
    getEffectiveSelectionCount: selection.effectiveSelectionCount,
    getAppliedFilter: () => filter.appliedFilter,
    getTotalCount: () => paging.totalCount,
    getSortKeys: () => layout.sortKeys,
    getRawColumnFields: () => rawColumnFields,
    getHidden: () => layout.hidden,
  });

  const deleteFlow = createDeleteFlow({
    sessionId, db, coll, gate: destructive,
    getSelectedIds: selection.selectedIds,
    setError: (msg) => { error = msg; },
    setLoading: (v) => { loading = v; },
    reload: reloadDocs,
  });

  /** Deletes one specific document (the quick-look drawer's Delete), whatever is selected in the grid. */
  function requestDeleteDoc(d: Doc) {
    const id = idJson(d);
    const row = id === null ? -1 : docs.findIndex((x) => idJson(x) === id);
    if (row === -1) return;
    selection.setSelected(new Set([row]));
    requestDeleteSelected();
  }

  /** Wraps deleteFlow's count-based confirm so the context menu / toolbar can call it with no args. */
  const requestDeleteSelected = () => deleteFlow.requestDeleteSelected(selection.selectedCount);

  async function copySelectedAs(format: "json" | "csv") {
    const rows = selection.effectiveRows();
    const picked = rows.map((r) => docs[r]).filter(Boolean);
    const text = format === "json" ? toJsonArray(picked) : toCsv(picked);
    await copy(text);
  }

  const menu = createCollectionMenu({
    getDocs: () => docs,
    selection,
    getBulk: () => bulk,
    getExportFlow: () => exportFlow,
    filterBy: (path, op, value) => filter.filterBy(path, op, value),
    reloadDocs: () => reloadDocs(),
    copy: (text) => copy(text),
    copySelectedAs,
    requestDeleteSelected,
    startEdit: (row, key) => edits.startEdit(row, key),
    newDocument,
  });

  const { edit, editBlur } = edits;

  return {
    get docs() { return docs; },
    get schema() { return schema; },
    get columnFields() { return columnFields; },
    get loading() { return loading; },
    get error() { return error; },
    get currentPage() { return paging.currentPage; },
    get pageCount() { return paging.pageCount; },
    get totalCount() { return paging.totalCount; },
    get allShown() { return paging.allShown; },
    get lastQueryMs() { return paging.lastQueryMs; }, get deepPageSlow() { return paging.deepPageSlow; },
    get presets() { return filter.presets; },
    saveViewPreset: filter.saveViewPreset,
    removeViewPreset: filter.removeViewPreset,
    applyViewPreset: filter.applyViewPreset,
    get pendingCount() { return pending().length; },
    get pendingCells() { return edits.pendingCells; },
    get committingPending() { return pendingEdits.isCommitting(sessionId, db, coll); },
    commitPending: edits.commitPending,
    discardPending: edits.discardPending,
    get showAllPending() { return showAll.showAllPending; },
    requestShowAll: showAll.requestShowAll,
    confirmShowAll: showAll.confirmShowAll,
    cancelShowAll: showAll.cancelShowAll,
    presetFilter: filter.presetFilter,
    get filterText() { return filter.filterText; },
    set filterText(v: string) { filter.filterText = v; },
    get filterError() { return filter.filterError; },
    applyFilter: filter.applyFilter,
    /** Chips of the applied filter; null when it can only be edited as JSON. */
    get chips() { return filter.chips; },
    setChips: filter.setChips,
    get fieldInfos() { return fieldInfoList; },
    /** Distinct values of a field in the loaded page (JSON text), [] when there are too many. */
    valuesFor: (path: string) => distinctValueTexts(docs, path, 20),
    slowFieldHint: (path: string) => !indexedFields.has(path) && paging.totalCount > SLOW_FIELD_MIN_DOCS,
    get zeroResult() { return paging.totalCount === 0 && filter.appliedFilter !== "{}" && !loading; },
    get filterHistory() { return filterHistoryStore.entriesFor(layoutKey); },
    pinFilter: (text: string, pinned: boolean) => filterHistoryStore.pin(layoutKey, text, pinned),
    clearFilterHistory: () => filterHistoryStore.clear(layoutKey),
    get loadGen() { return `${loadCount}|${quickSearch.appliedSearchRegex?.source ?? ""}`; },
    get searchTerm() { return quickSearch.searchTerm; },
    set searchTerm(v: string) { quickSearch.searchTerm = v; },
    get searchInvalid() { return quickSearch.searchInvalid; },
    get visibleIndices() { return visibleIndices; },
    /** The destructive operation waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
    get editing() { return edit.editing; },
    get editText() { return edit.editText; },
    set editText(v: string) { edit.editText = v; },
    get editTextLoading() { return edit.editTextLoading; },
    get editError() { return edit.editError; },
    get editBlurPending() { return editBlur.editBlurPending; },
    onEditBlur: editBlur.onEditBlur,
    confirmBlurEdit: editBlur.confirmBlurEdit,
    discardBlurEdit: editBlur.discardBlurEdit,
    get saving() { return edits.commitFlow.saving; },
    get menu() { return selection.menu; },
    get selected() { return selection.selected; },
    get selectedCount() { return selection.selectedCount; },
    clickRow: selection.clickRow,
    setSelected: selection.setSelected,
    selectAll: selection.selectAll,
    invertSelection: selection.invertSelection,
    clearSelection: selection.clearSelection,
    selectedIds: selection.selectedIds,
    requestDeleteSelected,
    get sortKeys() { return layout.sortKeys; },
    get view() { return layout.view; },
    set view(v: "grid" | "tree") { layout.view = v; },
    get hidden() { return layout.hidden; },
    get hiddenDraft() { return layout.hiddenDraft; },
    get colWidths() { return layout.colWidths; },
    setColWidth: layout.setColWidth,
    resetColWidth: layout.resetColWidth,
    get pageSize() { return paging.pageSize; },
    toggleSort: layout.toggleSort,
    addSort: layout.addSort,
    toggleSortDirAt: layout.toggleSortDirAt,
    removeSort: layout.removeSort,
    moveSort: layout.moveSort,
    clearSort: layout.clearSort,
    showAllFieldsDraft: layout.showAllFieldsDraft,
    hideAllFieldsDraft: layout.hideAllFieldsDraft,
    setPageSize: paging.setPageSize,
    goToPage: paging.goToPage,
    nextPage: paging.nextPage,
    prevPage: paging.prevPage,
    firstPage: paging.firstPage,
    lastPage: paging.lastPage,
    toggleHiddenDraft: layout.toggleHiddenDraft,
    applyProjection: layout.applyProjection,
    resetProjectionDraft: layout.resetProjectionDraft,
    openDoc,
    replaceDoc,
    requestDeleteDoc,
    get pinned() { return layout.pinned; },
    togglePin: layout.togglePin,
    filterBy: filter.filterBy,
    headerMenuItems: layout.headerMenuItems,
    onHeaderMenuSelect: layout.onHeaderMenuSelect,
    init,
    resetLayout: layout.resetLayout,
    /** Reloads the page when an undo wrote to this collection. */
    syncAfterUndo(change: { sessionId: string; db: string; coll: string } | null) {
      if (change && change.sessionId === sessionId && change.db === db && change.coll === coll) void reloadDocs();
    },
    startEdit: edits.startEdit,
    cancelEdit: editBlur.cancelEdit,
    commitEdit: edits.commitFlow.commitEdit,
    openMenu: selection.openMenu,
    closeMenu: selection.closeMenu,
    menuItems: menu.menuItems,
    onMenuSelect: menu.onMenuSelect,
    requestDelete: deleteFlow.requestDelete,
    copy,
    get appliedFilter() { return filter.appliedFilter; },
    get bulkMode() { return bulk.bulkMode; },
    get bulkUpdateText() { return bulk.bulkUpdateText; },
    set bulkUpdateText(v: string) { bulk.bulkUpdateText = v; },
    get bulkUpdateError() { return bulk.bulkUpdateError; },
    get bulkCount() { return bulk.bulkCount; },
    get bulkCounting() { return bulk.bulkCounting; },
    get bulkRunning() { return bulk.bulkRunning; },
    get bulkScope() { return bulk.bulkScope; },
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
