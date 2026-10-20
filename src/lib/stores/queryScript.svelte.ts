import { untrack } from "svelte";
import { getByPath } from "../domain/schema";
import { clampWidth } from "../domain/colwidth";
import { matchingIndices } from "../domain/search";
import { settings } from "./settings.svelte";
import { fieldsFor as sharedFieldsFor } from "./fieldSuggestions";
import { createQuickSearch } from "./quickSearch.svelte";
import { createEditBlurFlow } from "./cellEditBlur.svelte";
import { createCellEditEntry } from "./cellEditEntry.svelte";
import { editTextOf, setByPath } from "../domain/celledit";
import { idJson } from "../domain/docid";
import * as m from "#lib/paraglide/messages.js";
import { createRowSelection } from "./rowSelection.svelte";
import { createCommitEditFlow } from "./commitEditFlow.svelte";
import { createScriptResult } from "./scriptResult.svelte";
import { createScriptExplain } from "./scriptExplain.svelte";
import { createScriptRun } from "./scriptRun.svelte";
import { createScriptResultGrid } from "./scriptResultGrid.svelte";

/** Per-tab state for one QuickJS Query tab: run script + client-side paging + column widths. */
export function createQueryScript(sessionId: string, initialStatement: string, opts: { tabId?: number } = {}) {
  // Wrap initialStatement with untrack to avoid the state_referenced_locally warning when this store is created inside a reactive context.
  let statementText = $state(untrack(() => initialStatement));

  // Inline/modal cell edit (row index is relative to the CURRENT PAGE's `docs`, in both modes);
  // same factory as the collection grid.
  const edit = createCellEditEntry();

  // Result state shared by the run / explain / grid helpers below.
  const result = createScriptResult({ clearEdit: () => edit.clear() });

  // Client-side quick search (HeidiSQL-style): filters the current in-memory result set in place, no server round-trip.
  const quickSearch = createQuickSearch();
  const visibleIndices = $derived(matchingIndices(result.docs, result.columnFields, quickSearch.appliedSearchRegex));

  // Row selection (indices into the current page's `docs`) — shared with collectionView.svelte.ts's
  // Data tab; also owns the right-click context menu.
  const selection = createRowSelection({
    getDocs: () => result.docs,
    getVisibleIndices: () => visibleIndices,
  });

  /** A query tab's session isn't fixed for its lifetime — the caller may pass a different
   *  `intendedSessionId` into run/runSelection/explainAfterRun once the user has navigated to
   *  another session in the sidebar. Reassigning this parameter (legal — function params aren't
   *  const) is deliberate: every other function below reads the closed-over `sessionId` fresh on
   *  each call, so this single assignment retargets the whole store without threading a getter
   *  through each call site. */
  function rebindSession(newSessionId: string): void {
    sessionId = newSessionId;
  }

  let pendingSessionSwitch = $state<{ fromSessionId: string; toSessionId: string; retry: () => Promise<void> } | null>(null);

  /** Gate for run/runSelection/explainAfterRun: when the caller's intended session differs from
   *  the one this store is currently bound to, stash the retry and surface a confirm dialog instead
   *  of silently running against the wrong session. Returns true if the caller should stop here. */
  function guardSessionSwitch(intendedSessionId: string | undefined, retry: () => Promise<void>): boolean {
    if (!intendedSessionId || intendedSessionId === sessionId) return false;
    pendingSessionSwitch = { fromSessionId: sessionId, toSessionId: intendedSessionId, retry };
    return true;
  }

  async function confirmSessionSwitch(): Promise<void> {
    const p = pendingSessionSwitch;
    pendingSessionSwitch = null;
    if (!p) return;
    rebindSession(p.toSessionId);
    await p.retry();
  }

  function cancelSessionSwitch(): void {
    pendingSessionSwitch = null;
  }

  const explain = createScriptExplain({
    getSessionId: () => sessionId,
    result,
    guardSessionSwitch,
    run: (db, script, intendedSessionId) => scriptRun.run(db, script, intendedSessionId),
  });

  const scriptRun = createScriptRun({
    getSessionId: () => sessionId,
    result,
    selection,
    explain,
    tabId: opts.tabId ?? null,
    getStatementText: () => statementText,
    guardSessionSwitch,
  });

  const grid = createScriptResultGrid({
    getSessionId: () => sessionId,
    result,
    selection,
    getRun: () => scriptRun,
    startEdit: (row, key) => startEdit(row, key),
    clearEdit: () => edit.clear(),
  });

  // Delegates to the shared, session-keyed cache in stores/fieldSuggestions.ts (also used by the
  // Pipeline Builder and Document form) so the same collection is never re-sampled redundantly.
  function fieldsFor(db: string, coll: string): Promise<string[]> {
    return sharedFieldsFor(sessionId, db, coll);
  }

  // Editor selection range (chars into statementText), kept in sync by the textarea; enables "Run selection".
  let selStart = $state(0);
  let selEnd = $state(0);
  const hasSelection = $derived(selStart !== selEnd && statementText.slice(selStart, selEnd).trim().length > 0);

  function setSelection(start: number, end: number) {
    selStart = start;
    selEnd = end;
  }

  // History panel visibility (per tab; toggled by the title-row button and Mod+H).
  let historyOpen = $state(false);

  /** Run only the highlighted text (falls back to the whole statement if nothing is selected). */
  function runSelection(db: string | null, intendedSessionId?: string) {
    const stmt = hasSelection ? statementText.slice(selStart, selEnd) : statementText;
    return scriptRun.run(db, stmt, intendedSessionId);
  }

  function startEdit(row: number, key: string) {
    if (!result.isEditable()) return;
    const doc = result.docs[row];
    if (!doc || idJson(doc) === null) return;
    edit.begin(row, key, getByPath(doc, key));
  }

  const editBlur = createEditBlurFlow({
    getEditing: () => edit.editing,
    isSaving: () => commitFlow.saving,
    clearEditing: () => edit.clear(),
    getEditText: () => edit.editText,
    getOriginalText: (row, key) => {
      const doc = result.docs[row];
      return doc ? editTextOf(getByPath(doc, key)) : "";
    },
    commitEdit: () => commitFlow.commitEdit(),
  });

  const commitFlow = createCommitEditFlow({
    getSessionId: () => sessionId,
    edit,
    getDocs: () => result.docs,
    setDocs: (next) => { result.docs = next; },
    getTarget: () => (result.provenance ? { db: result.provenance.db, coll: result.provenance.coll } : null),
    noIdMessage: () => m.query_run_selection_missing_id(),
    currentGeneration: () => result.generation,
    // Static ("materialized") mode keeps a second copy of the full result in `fullDocs`, of which
    // `docs` is just a page slice (or the same array when `showingAll`) -- patch it by the same
    // index instead of a linear idJson() scan over the whole result set on every edit.
    onCommitted: (row, key, value) => {
      if (result.recipe) return;
      const idx = result.showingAll ? row : (result.page - 1) * result.pageSize + row;
      if (idx < 0 || idx >= result.fullDocs.length) return;
      result.fullDocs[idx] = setByPath(result.fullDocs[idx], key, value);
      result.fullDocs = [...result.fullDocs];
    },
  });

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; explain.recipeDirty = true; },
    get docs() { return result.docs; },
    get visibleIndices() { return visibleIndices; },
    get columnFields() { return result.columnFields; },
    get searchTerm() { return quickSearch.searchTerm; },
    get staleAfterUndo() { return scriptRun.staleAfterUndo; },
    get historyOpen() { return historyOpen; },
    toggleHistory() { historyOpen = !historyOpen; },
    syncAfterUndo: scriptRun.syncAfterUndo,
    get loadGen() { return `${result.loadCount}|${quickSearch.appliedSearchRegex?.source ?? ""}`; },
    set searchTerm(v: string) { quickSearch.searchTerm = v; },
    get searchInvalid() { return quickSearch.searchInvalid; },
    get consoleEntries() { return result.consoleEntries; },
    get lastElapsedMs() { return result.lastElapsedMs; },
    clearConsole: scriptRun.clearConsole,
    get displayMode() { return result.displayModeVal; },
    get previewLabel() { return scriptRun.previewLabel; },
    showPreview: scriptRun.showPreview,
    clearPreview: scriptRun.clearPreview,
    get valueJson() { return result.valueJson; },
    get ackJson() { return result.ackJson; },
    get capped() { return result.capped; },
    get error() { return result.error; },
    get running() { return result.running; },
    get loading() { return result.loading; },
    get provenance() { return result.provenance; },
    get currentPage() { return result.page; },
    get pageCount() { return result.pgCount; },
    get totalCount() { return result.totalCount; },
    get pageSize() { return result.pageSize; },
    get allShown() { return result.showingAll; },
    get colWidths() { return result.colWidths; },
    get canExplain() { return explain.canExplain; },
    get explainSummary() { return explain.explainSummary; },
    get explainRawJson() { return explain.explainRawJson; },
    get explainPrevSummary() { return explain.explainPrevSummary; },
    get explainLoading() { return explain.explainLoading; },
    get explainError() { return explain.explainError; },
    get indexSuggestion() { return explain.indexSuggestion; },
    get explainRequestSeq() { return explain.explainRequestSeq; },
    ensureExplain: explain.ensureExplain,
    showExplain: explain.showExplain,
    explainAfterRun: explain.explainAfterRun,
    runExplain: explain.runExplain,
    createSuggestedIndex: explain.createSuggestedIndex,
    get destructiveConfirm() { return scriptRun.destructiveConfirm; },
    get criticalConfirm() { return scriptRun.criticalConfirm; },
    get sessionId() { return sessionId; },
    get pendingSessionSwitch() { return pendingSessionSwitch; },
    confirmSessionSwitch,
    cancelSessionSwitch,
    rebindSession,
    run: (db: string | null, intendedSessionId?: string) => scriptRun.run(db, undefined, intendedSessionId),
    confirmRun: scriptRun.confirmRun,
    cancelConfirm: scriptRun.cancelConfirm,
    dontAskAgain: scriptRun.dontAskAgain,
    confirmCritical: scriptRun.confirmCritical,
    cancelCritical: scriptRun.cancelCritical,
    cancel: scriptRun.cancel,
    runSelection,
    setSelection,
    fieldsFor,
    get hasSelection() { return hasSelection; },
    goToPage: scriptRun.goToPage,
    nextPage: scriptRun.nextPage,
    prevPage: scriptRun.prevPage,
    firstPage: scriptRun.firstPage,
    lastPage: scriptRun.lastPage,
    setPageSize: scriptRun.setPageSize,
    requestShowAll: scriptRun.showAll.requestShowAll,
    confirmShowAll: scriptRun.showAll.confirmShowAll,
    cancelShowAll: scriptRun.showAll.cancelShowAll,
    get showAllPending() { return scriptRun.showAll.showAllPending; },
    setColWidth: (path: string, px: number) => { result.colWidths = { ...result.colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { result.colWidths = { ...result.colWidths, [path]: result.defaultColWidths[path] ?? 160 }; },
    get editing() { return edit.editing; },
    get editText() { return edit.editText; },
    set editText(v: string) { edit.editText = v; },
    get editTextLoading() { return edit.editTextLoading; },
    get editError() { return edit.editError; },
    get saving() { return commitFlow.saving; },
    get editBlurPending() { return editBlur.editBlurPending; },
    onEditBlur: editBlur.onEditBlur,
    confirmBlurEdit: editBlur.confirmBlurEdit,
    discardBlurEdit: editBlur.discardBlurEdit,
    startEdit,
    commitEdit: commitFlow.commitEdit,
    cancelEdit: editBlur.cancelEdit,
    get selected() { return selection.selected; },
    get menu() { return selection.menu; },
    replaceDoc: grid.replaceDoc,
    fullDocFor: grid.fullDocFor,
    clickRow: selection.clickRow,
    setSelected: selection.setSelected,
    invertSelection: selection.invertSelection,
    openMenu: selection.openMenu,
    closeMenu: selection.closeMenu,
    menuItems: grid.menuItems,
    onMenuSelect: grid.onMenuSelect,
    get ioError() { return result.ioError; },
    /** The selection delete waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return grid.destructive; },
    get exportRequest() { return grid.exportRequest; },
    cancelExport: grid.cancelExport,
    exportInput: grid.exportInput,
    get canEditSelected() { return grid.canEditSelected; },
    get canDeleteSelected() { return grid.canDeleteSelected; },
    getSelectedForEdit: grid.getSelectedForEdit,
    requestDeleteSelected: grid.requestDeleteSelected,
    requestExportCurrent: grid.requestExportCurrent,
  };
}
