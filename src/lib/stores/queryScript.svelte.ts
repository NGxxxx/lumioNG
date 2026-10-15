import { untrack } from "svelte";
import { runScript, cancelScript, type ConsoleEntry, type Provenance, type ExplainHint } from "../api/script";
import { queryPage, aggregate, aggregateCount, countDocuments, explainQuery, fetchFullDoc } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows, type DisplayMode } from "../domain/scriptOutcome";
import { mergeColumns, getByPath, limitColumnsToDepth, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive, scanCritical } from "../domain/scriptScan";
import { matchingIndices } from "../domain/search";
import { settings } from "./settings.svelte";
import { fieldsFor as sharedFieldsFor } from "./fieldSuggestions";
import { createQuickSearch } from "./quickSearch.svelte";
import { createEditBlurFlow } from "./cellEditBlur.svelte";
import { createCellEditEntry } from "./cellEditEntry.svelte";
import { createShowAllFlow } from "./showAllFlow.svelte";
import { deleteMany } from "../api/documents";
import { createIndex } from "../api/indexes";
import { summarizeExplain, type ExplainSummary } from "../domain/explainPlan";
import { suggestIndex } from "../domain/indexAdvisor";
import { idJson } from "../domain/docid";
import { clipboardTextOf } from "../domain/extjson";
import { isInlineEditable, isModalEditable, editTextOf, setByPath } from "../domain/celledit";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { deleteManyCmd, findOneByIdCmd } from "../domain/mongosh";
import * as m from "#lib/paraglide/messages.js";
import { idInFilter } from "../domain/selection";
import { toJsonArray, toCsv } from "../domain/exporter";
import type { ExportWizardInput } from "../domain/exportPlan";
import type { MenuItem } from "../domain/gridView";
import { createRowSelection } from "./rowSelection.svelte";
import { createCommitEditFlow } from "./commitEditFlow.svelte";
import { createClipboardCopy } from "./clipboardCopy";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { canSuppress } from "../domain/confirmPolicy";
import { UNDO_DELETE_CAP, snapshotForUndo, recordDelete } from "./documentWrites";

/** Per-tab state for one QuickJS Query tab: run script + client-side paging + column widths. */
export function createQueryScript(sessionId: string, initialStatement: string) {
  // Wrap initialStatement with untrack to avoid the state_referenced_locally warning when this store is created inside a reactive context.
  let statementText = $state(untrack(() => initialStatement));

  // "static" mode (unchanged old behavior): the FULL result already materialized through QuickJS; `docs` is a client-side slice of this.
  let fullDocs = $state.raw<Doc[]>([]);
  // "paged" mode (pure find()/aggregate() cursor): non-null `recipe` means every page is fetched directly from Rust, bypassing QuickJS entirely.
  type PagedRecipe = {
    cursorKind: "find" | "agg";
    db: string; coll: string;
    query: string;
    sort: string | null;
    projection: string | null;
    baseSkip: number;
    fixedLimit: number | null;
  };
  let recipe = $state<PagedRecipe | null>(null);
  /** True once the editor is touched after the run that produced `recipe`/`explainHint`, so Explain knows to re-run instead of silently reusing a stale plan. */
  let recipeDirty = $state(false);
  /** The query of the script's single constructed Cursor (from `outcome.explainHint`) — drives Explain for `.map()`/`.forEach()` scripts too, not just paged mode. */
  let explainHint = $state<ExplainHint | null>(null);

  let explainSummary = $state<ExplainSummary | null>(null);
  let explainRawJson = $state<string | null>(null);
  let explainPrevSummary = $state<ExplainSummary | null>(null);
  let explainLoading = $state(false);
  let explainError = $state<string | null>(null);
  // Bumped by `showExplain()` — QueryTab.svelte watches this so a trigger outside the tab component (the global Toolbar's Explain button) can still switch its view.
  let explainRequestSeq = $state(0);

  // `docs` always means "current page," in EITHER mode — reassigned wholesale by every fetch/page-change/edit ($state.raw, per CLAUDE.md).
  let docs = $state.raw<Doc[]>([]);
  let consoleEntries = $state.raw<ConsoleEntry[]>([]);

  let rawColumnFields = $state<ColumnField[]>([]);
  const columnFields = $derived(limitColumnsToDepth(rawColumnFields, settings.gridMaxDepth));
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});

  // Client-side quick search (HeidiSQL-style): filters the current in-memory result set in place, no server round-trip.
  const quickSearch = createQuickSearch();
  const visibleIndices = $derived(matchingIndices(docs, columnFields, quickSearch.appliedSearchRegex));

  let displayModeVal = $state<DisplayMode>("none");
  let valueJson = $state<string | null>(null);
  let ackJson = $state<string | null>(null);
  let capped = $state(false);
  let error = $state<string | null>(null);
  let running = $state(false);
  let loading = $state(false);
  let provenance = $state<Provenance | null>(null);
  let lastElapsedMs = $state<number | null>(null);

  let pageSize = $state(50);
  let pageReq = $state(1);
  let showingAll = $state(false);
  let totalCount = $state(0);
  // Guards against overlapping in-flight paged-mode fetches (double-click nextPage, fast page-jump typing, etc.), same pattern as collectionView.svelte.ts.
  let generation = 0;

  let destructiveConfirm = $state<{ ops: string[]; /** PROD: cannot be suppressed, says so. */ prod: boolean } | null>(null);
  /** Critical-tier destructive ops (dropDatabase/drop/dropIndex(es), or an empty-filter mass
   *  write) — always confirmed via typed name, bypassing `settings.suppressDestructiveWarning`. */
  let criticalConfirm = $state<{ ops: string[] } | null>(null);
  let pending: { db: string; script: string } | null = null;

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

  // Inline/modal cell edit (row index is relative to the CURRENT PAGE's `docs`, in both modes);
  // same factory as the collection grid.
  const edit = createCellEditEntry();

  /** Bump on every run/navigation/reload: in-flight fetches captured the old value and bail out, and
   *  any open cell edit is dropped — `editing.row` indexes the OLD page's `docs`, so leaving it open
   *  would silently rebind the edit box (and the eventual $set) to a different document. */
  function bumpGeneration(): number {
    edit.clear();
    return ++generation;
  }

  // Row selection (indices into the current page's `docs`) — shared with collectionView.svelte.ts's
  // Data tab; also owns the right-click context menu.
  const selection = createRowSelection({
    getDocs: () => docs,
    getVisibleIndices: () => visibleIndices,
  });
  let ioError = $state<string | null>(null);
  // Selection deletes confirm through the environment policy (sessionId is read fresh: it can be rebound).
  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));
  let exportRequest = $state<{ rows: Doc[] } | null>(null);

  /** True when edit/delete actions are permitted (pure single-collection cursor result). */
  function isEditable(): boolean {
    return displayModeVal === "grid-editable" && provenance !== null;
  }

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

  const indexSuggestion = $derived(
    explainHint && (explainSummary?.verdict === "collscan" || explainSummary?.verdict === "ixscan-inefficient")
      ? suggestIndex(explainHint.coll, explainHint.query, explainHint.sort)
      : null,
  );

  const pgCount = $derived(
    recipe && recipe.fixedLimit !== null ? 1 : (showingAll ? 1 : pageCount(totalCount, pageSize)),
  );
  const page = $derived(showingAll ? 1 : clampPage(pageReq, pgCount));

  /** Fetch one page directly from Rust for a "paged" recipe — bypasses QuickJS entirely. */
  async function fetchPagedPage(r: PagedRecipe, skip: number, limit: number): Promise<Doc[]> {
    return r.cursorKind === "agg"
      ? await aggregate(sessionId, r.db, r.coll, r.query, skip, limit, settings.queryTimeoutMs)
      : await queryPage(sessionId, r.db, r.coll, skip, limit, r.query, r.sort, r.projection, settings.queryTimeoutMs);
  }

  /** Total count for a "paged" recipe (the full match, ignoring the recipe's own skip/limit). */
  async function countPaged(r: PagedRecipe): Promise<number> {
    activity.begin(m.status_bar_running_query());
    try {
      return r.cursorKind === "agg"
        ? await aggregateCount(sessionId, r.db, r.coll, r.query, settings.queryTimeoutMs)
        : await countDocuments(sessionId, r.db, r.coll, r.query, settings.queryTimeoutMs);
    } finally {
      activity.end();
    }
  }

  /** Load the current page in "paged" mode; recomputes columns from THIS page only (accepted tradeoff, avoids an extra schema-sampling round-trip). No-op in "static" mode. */
  async function loadPagedCurrentPage() {
    if (!recipe) return;
    const r = recipe;
    const gen = generation;
    loading = true;
    activity.begin(m.status_bar_running_query());
    try {
      const result = r.fixedLimit !== null
        ? await fetchPagedPage(r, r.baseSkip, r.fixedLimit)
        : await fetchPagedPage(r, r.baseSkip + (page - 1) * pageSize, pageSize);
      if (gen !== generation) return;
      docs = result;
      if (r.fixedLimit !== null) totalCount = docs.length;
      rawColumnFields = mergeColumns(null, docs);
      defaultColWidths = computeColumnWidths(columnFields, docs);
      colWidths = { ...defaultColWidths };
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
      activity.end();
    }
  }

  async function runExplain(): Promise<void> {
    if (!explainHint) return;
    const r = explainHint;
    const gen = generation;
    explainLoading = true;
    explainError = null;
    activity.begin(m.status_bar_running_query());
    try {
      const json = await explainQuery(
        sessionId, r.cursorKind, r.db, r.coll, r.query, r.sort, r.projection, r.skip, r.limit,
        settings.queryTimeoutMs,
      );
      if (gen !== generation) return; // a fresh run superseded this in-flight explain — discard it
      explainRawJson = json;
      explainSummary = summarizeExplain(JSON.parse(json));
    } catch (e) {
      if (gen !== generation) return;
      explainError = errorMessage(e);
    } finally {
      if (gen === generation) explainLoading = false;
      activity.end();
    }
  }

  function isExplainable(): boolean {
    return explainHint !== null && !recipeDirty;
  }

  /** Fetches Explain only if it hasn't been fetched since the last run, so repeated toggling doesn't re-run the (potentially slow) explain command. */
  function ensureExplain(): void {
    if (!explainSummary && !explainLoading) void runExplain();
  }

  /** Entry point for the Explain action from OUTSIDE the tab component (global Toolbar button) — bumps a signal QueryTab.svelte watches to switch its `resultView` to "explain" and fetch it. */
  function showExplain(): void {
    explainRequestSeq++;
    ensureExplain();
  }

  /** Explain, running the query first if needed (the recipe it needs only exists after a run); if it still isn't a pure cursor afterward, this quietly does nothing further. */
  async function explainAfterRun(db: string | null, intendedSessionId?: string): Promise<void> {
    if (guardSessionSwitch(intendedSessionId, () => explainAfterRun(db, intendedSessionId))) return;
    if (!isExplainable()) {
      await run(db, undefined, intendedSessionId);
    }
    if (explainHint) {
      showExplain();
    }
  }

  async function createSuggestedIndex(): Promise<void> {
    if (!explainHint || !indexSuggestion || !explainSummary) return;
    const r = explainHint;
    const suggestion = indexSuggestion;
    const prev = explainSummary;
    const gen = generation;
    try {
      await commandLog.pushTimed(suggestion.snippet, sessionId, () =>
        createIndex(sessionId, r.db, r.coll, JSON.stringify(suggestion.keys), false, null, false, null, null, null));
      if (gen !== generation) return; // a fresh run superseded this before the index finished
      explainPrevSummary = prev;
      await runExplain();
    } catch (e) {
      ioError = errorMessage(e);
    }
  }

  async function execute(db: string, script: string) {
    running = true;
    error = null;
    selection.clearSelection();
    selection.closeMenu();
    showingAll = false;
    pageReq = 1;
    recipe = null;
    explainHint = null;
    explainSummary = null;
    explainRawJson = null;
    explainPrevSummary = null;
    explainLoading = false;
    explainError = null;
    showAll.cancelShowAll();
    bumpGeneration(); // invalidate any still in-flight paged fetch (and drop any open cell edit) from before this fresh run
    const startedAt = Date.now();
    activity.begin(m.status_bar_running_query());
    try {
      const outcome = await runScript(sessionId, db, script, {
        timeoutMs: settings.queryTimeoutMs,
        cap: settings.queryResultCapUnlimited ? 0 : settings.queryResultCap,
      });
      commandLog.push(script, sessionId, Date.now() - startedAt);

      consoleEntries = outcome.console;
      explainHint = outcome.explainHint ?? null;
      displayModeVal = computeDisplayMode(outcome);

      if (outcome.result.kind === "docs") {
        fullDocs = parseRows(outcome.result.rows);
        docs = fullDocs.slice(0, pageSize);
        rawColumnFields = mergeColumns(null, fullDocs);
        defaultColWidths = computeColumnWidths(columnFields, fullDocs);
        colWidths = { ...defaultColWidths };
        provenance = outcome.provenance;
        totalCount = fullDocs.length;
        capped = outcome.capped;
        valueJson = null;
        ackJson = null;
      } else if (outcome.result.kind === "cursorQuery") {
        const r = outcome.result;
        recipe = {
          cursorKind: r.cursorKind, db: r.db, coll: r.coll, query: r.query,
          sort: r.sort, projection: r.projection, baseSkip: r.baseSkip, fixedLimit: r.fixedLimit,
        };
        recipeDirty = false;
        fullDocs = [];
        docs = [];
        rawColumnFields = [];
        provenance = { db: r.db, coll: r.coll };
        capped = false;
        valueJson = null;
        ackJson = null;
        if (recipe.fixedLimit === null) {
          const gen = generation;
          const total = await countPaged(recipe);
          if (gen !== generation) return;
          totalCount = total;
        }
        await loadPagedCurrentPage();
      } else if (outcome.result.kind === "value") {
        valueJson = outcome.result.json;
        docs = [];
        fullDocs = [];
        rawColumnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        ackJson = null;
      } else if (outcome.result.kind === "ack") {
        ackJson = outcome.result.json;
        docs = [];
        fullDocs = [];
        rawColumnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        valueJson = null;
      } else {
        // kind === "none"
        docs = [];
        fullDocs = [];
        rawColumnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        valueJson = null;
        ackJson = null;
      }

      error = outcome.error;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      lastElapsedMs = Date.now() - startedAt;
      running = false;
      activity.end();
    }
  }

  function clearConsole() {
    consoleEntries = [];
  }

  async function run(db: string | null, script: string = statementText, intendedSessionId?: string) {
    if (guardSessionSwitch(intendedSessionId, () => run(db, script, intendedSessionId))) return;
    if (!db) {
      error = "Select a database first.";
      return;
    }
    const critical = scanCritical(script);
    if (critical.length) {
      pending = { db, script };
      criticalConfirm = { ops: critical };
      return;
    }
    const ops = scanDestructive(script);
    // "Don't ask again" never applies on PROD.
    const prod = !canSuppress(sessionEnvironment(sessionId), "script");
    if (ops.length && (prod || !settings.suppressDestructiveWarning)) {
      pending = { db, script };
      destructiveConfirm = { ops, prod };
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

  async function confirmCritical() {
    const p = pending;
    criticalConfirm = null;
    pending = null;
    if (p) await execute(p.db, p.script);
  }

  function cancelCritical() {
    criticalConfirm = null;
    pending = null;
  }

  async function dontAskAgain() {
    if (!destructiveConfirm?.prod) settings.setSuppressDestructiveWarning(true);
    await confirmRun();
  }

  function cancel() {
    cancelScript(sessionId);
  }

  /** Run only the highlighted text (falls back to the whole statement if nothing is selected). */
  function runSelection(db: string | null, intendedSessionId?: string) {
    const stmt = hasSelection ? statementText.slice(selStart, selEnd) : statementText;
    return run(db, stmt, intendedSessionId);
  }

  /** Show ALL: totalCount is already fetched right after execute() (both "paged" and "static"
   *  modes), so the shared flow gates off it directly instead of re-counting — avoids a redundant
   *  round-trip. `showingAll` only flips once the rows are actually in hand, so a superseded or
   *  failed fetch leaves the pager exactly as it was. */
  const showAll = createShowAllFlow({
    getTotalCount: () => totalCount,
    bumpGeneration,
    currentGeneration: () => generation,
    canShowAll: () => !(recipe && recipe.fixedLimit !== null), // fixed-limit results have no show-all
    setError: (msg) => { error = msg; },
    setLoading: (v) => { loading = v; },
    load: async (stale) => {
      if (!recipe) {
        docs = fullDocs; // already fully materialized (static mode) — instant, no round-trip
        showingAll = true;
        return;
      }
      const r = recipe;
      const result = await fetchPagedPage(r, r.baseSkip, totalCount);
      if (stale()) return;
      docs = result;
      fullDocs = docs;
      showingAll = true;
    },
  });

  async function goToPage(p: number) {
    if (recipe && recipe.fixedLimit !== null) return; // fixed-limit results have no pager
    showingAll = false; // every page-navigation action unconditionally exits show-all mode
    pageReq = clampPage(p, pgCount);
    bumpGeneration();
    if (recipe) await loadPagedCurrentPage();
    else docs = fullDocs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  }
  const nextPage = () => goToPage(page + 1);
  const prevPage = () => goToPage(page - 1);
  const firstPage = () => goToPage(1);
  const lastPage = () => goToPage(pgCount);

  /** In-place reload of the current page (same recipe query): recount + refetch. Only meaningful
   *  for a pure paged cursor result — a materialized/static result (script had .map()/writes/no
   *  single query left to re-run) has nothing safe to re-fetch, so callers must gate on `recipe`. */
  async function refreshResults() {
    if (!recipe) return;
    const r = recipe;
    const gen = bumpGeneration();
    if (r.fixedLimit === null) {
      const total = await countPaged(r);
      if (gen !== generation) return;
      totalCount = total;
      pageReq = clampPage(page, pageCount(totalCount, pageSize));
    }
    await loadPagedCurrentPage();
  }

  async function setPageSize(n: number) {
    if (recipe && recipe.fixedLimit !== null) return;
    showingAll = false; // changing page size always exits show-all mode
    pageSize = Math.max(1, Math.floor(n) || 50);
    pageReq = 1;
    bumpGeneration();
    if (recipe) await loadPagedCurrentPage();
    else docs = fullDocs.slice(0, pageSize);
  }

  function startEdit(row: number, key: string) {
    if (!isEditable()) return;
    const doc = docs[row];
    if (!doc || idJson(doc) === null) return;
    edit.begin(row, key, getByPath(doc, key));
  }

  const editBlur = createEditBlurFlow({
    getEditing: () => edit.editing,
    isSaving: () => commitFlow.saving,
    clearEditing: () => edit.clear(),
    getEditText: () => edit.editText,
    getOriginalText: (row, key) => {
      const doc = docs[row];
      return doc ? editTextOf(getByPath(doc, key)) : "";
    },
    commitEdit: () => commitFlow.commitEdit(),
  });
  const cancelEdit = editBlur.cancelEdit;
  const onEditBlur = editBlur.onEditBlur;
  const confirmBlurEdit = editBlur.confirmBlurEdit;
  const discardBlurEdit = editBlur.discardBlurEdit;

  const commitFlow = createCommitEditFlow({
    getSessionId: () => sessionId,
    edit,
    getDocs: () => docs,
    setDocs: (next) => { docs = next; },
    getTarget: () => (provenance ? { db: provenance.db, coll: provenance.coll } : null),
    noIdMessage: () => m.query_run_selection_missing_id(),
    currentGeneration: () => generation,
    // Static ("materialized") mode keeps a second copy of the full result in `fullDocs`, of which
    // `docs` is just a page slice (or the same array when `showingAll`) -- patch it by the same
    // index instead of a linear idJson() scan over the whole result set on every edit.
    onCommitted: (row, key, value) => {
      if (recipe) return;
      const idx = showingAll ? row : (page - 1) * pageSize + row;
      if (idx < 0 || idx >= fullDocs.length) return;
      fullDocs[idx] = setByPath(fullDocs[idx], key, value);
      fullDocs = [...fullDocs];
    },
  });

  function menuItems(): MenuItem[] {
    const menu = selection.menu;
    if (!menu) return [];
    const doc = docs[menu.row];
    const n = selection.effectiveRows().length;
    const hasId = doc ? idJson(doc) !== null : false;
    const editable = isEditable();
    const allHaveId = selection.effectiveRows().every((r) => { const d = docs[r]; return d ? idJson(d) !== null : false; });
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: m.context_menu_open_document(), action: "open", disabled: !hasId || n !== 1 });
    }
    if (menu.source === "tree") items.push({ label: m.context_menu_expand_full_depth(), action: "expandFullDepth" });
    items.push({ label: m.context_menu_refresh(), action: "refresh", disabled: !recipe });
    if (editable) {
      items.push({
        label: m.context_menu_edit_cell(), action: "editCell",
        disabled: !doc || idJson(doc) === null
          || (!isInlineEditable(menu.key, getByPath(doc, menu.key)) && !isModalEditable(menu.key, getByPath(doc, menu.key))),
      });
    }
    const copyChildren: MenuItem[] = [
      { label: m.context_menu_copy_value(), action: "copyValue" },
      { label: m.context_menu_copy_field_path(), action: "copyPath" },
      { label: m.context_menu_copy_id(), action: "copyId", disabled: !hasId },
      { label: m.context_menu_copy_selected_json({ count: n }), action: "copyJson" },
      { label: m.context_menu_copy_selected_csv({ count: n }), action: "copyCsv" },
    ];
    if (editable) {
      items.push({ label: m.context_menu_copy(), action: "copy", children: copyChildren });
    } else {
      items.push(...copyChildren);
    }
    items.push({ label: m.context_menu_export(), action: "export", children: [
      { label: m.context_menu_export_selected({ count: n }), action: "exportSelected" },
      { label: m.context_menu_export_all_results(), action: "exportAll" },
    ]});
    if (editable) {
      items.push({ label: m.context_menu_delete_selected_n({ count: n }), action: "deleteSelected", disabled: !allHaveId });
    }
    return items;
  }

  const copy = createClipboardCopy((msg) => { ioError = msg; });

  function onMenuSelect(action: string): { open: Doc } | { expandFullDepth: number } | null {
    const menu = selection.menu;
    if (!menu) return null;
    const doc = docs[menu.row];
    const key = menu.key;
    const rows = selection.effectiveRows();
    const picked = rows.map((r) => docs[r]).filter(Boolean) as Doc[];
    switch (action) {
      case "open": selection.closeMenu(); return doc ? { open: doc } : null;
      case "expandFullDepth": { const r = menu.row; selection.closeMenu(); return { expandFullDepth: r }; }
      case "refresh": refreshResults(); break;
      case "editCell": { const r = menu.row; const k = menu.key; selection.closeMenu(); startEdit(r, k); return null; }
      case "copyValue": copy(clipboardTextOf(getByPath(doc, key))); break;
      case "copyPath": copy(key); break;
      case "copyId": copy(idJson(doc) ?? ""); break;
      case "copyJson": copy(toJsonArray(picked)); break;
      case "copyCsv": copy(toCsv(picked)); break;
      case "exportSelected": exportRequest = { rows: picked }; break;
      case "exportAll": exportRequest = { rows: docs }; break;
      case "deleteSelected": requestDelete(picked); break;
    }
    selection.closeMenu();
    return null;
  }

  function requestDelete(picked: Doc[]) {
    if (picked.length === 0 || !provenance) return;
    void destructive.request(
      { op: "deleteMany", target: { db: provenance.db, coll: provenance.coll }, count: picked.length, undoable: picked.length <= UNDO_DELETE_CAP },
      () => deleteSelected(picked),
    );
  }

  // ── activeDataView bridge: mirrors ResultTable's DataViewHandle shape, backed by `selected`/`docs` instead of collectionView's selection/paging state. ──

  /** The single selected row's doc, editable only when the result is a live grid-editable
   *  cursor (has a real db/coll `provenance`) and the doc carries an `_id`. */
  function getSelectedForEdit(): Doc | null {
    if (!isEditable() || selection.selected.size !== 1) return null;
    const d = docs[[...selection.selected][0]];
    return d && idJson(d) !== null ? d : null;
  }

  function requestDeleteSelected() {
    if (!isEditable()) return;
    const picked = [...selection.selected].map((r) => docs[r]).filter(Boolean) as Doc[];
    requestDelete(picked);
  }

  /** Exports the selection if any, else every currently loaded row (matches the "Export" ->
   *  "All results" context-menu action). */
  function requestExportCurrent() {
    const picked = [...selection.selected].map((r) => docs[r]).filter(Boolean) as Doc[];
    exportRequest = { rows: picked.length > 0 ? picked : docs };
  }

  async function deleteSelected(picked: Doc[]) {
    if (!provenance) return;
    const prov = provenance;
    const ids: string[] = [];
    for (const d of picked) {
      const id = idJson(d);
      if (id === null) { ioError = m.query_run_selection_missing_id(); return; }
      ids.push(id);
    }
    const filter = idInFilter(ids);
    loading = true;
    try {
      const snapshot = await snapshotForUndo(sessionId, prov.db, prov.coll, ids);
      await commandLog.pushTimed(deleteManyCmd(prov.coll, filter), sessionId, () =>
        deleteMany(sessionId, prov.db, prov.coll, filter, false));
      recordDelete(sessionId, prov.db, prov.coll, snapshot);
      selection.clearSelection();
      edit.clear();
      if (recipe) {
        const r = recipe;
        const gen = bumpGeneration();
        if (r.fixedLimit === null) {
          const total = await countPaged(r);
          if (gen !== generation) return;
          totalCount = total;
          pageReq = clampPage(page, pageCount(totalCount, pageSize));
        }
        await loadPagedCurrentPage();
      } else {
        fullDocs = fullDocs.filter((d) => { const id = idJson(d); return id === null || !ids.includes(id); });
        totalCount = fullDocs.length;
        docs = showingAll
          ? fullDocs
          : fullDocs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
      }
    } catch (e) {
      ioError = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function cancelExport() { exportRequest = null; }

  function exportInput(): ExportWizardInput | null {
    if (!exportRequest) return null;
    const colPaths = rawColumnFields.map((c) => ({ path: c.path, visible: true, type: c.type }));
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

  /** The whole document for a result row: re-fetched from the source collection when the result has
   *  one (a find() may be projected — editing a partial copy would wipe the other fields on save). */
  async function fullDocFor(d: Doc): Promise<Doc> {
    const id = idJson(d);
    if (!provenance || id === null) return d;
    const { db, coll } = provenance;
    const full = await commandLog.pushTimed(findOneByIdCmd(coll, id), sessionId, () => fetchFullDoc(sessionId, db, coll, id));
    return full ?? d;
  }

  /** Replaces the result row holding the same `_id` (after a save from the quick-look drawer). */
  function replaceDoc(saved: Doc) {
    const id = idJson(saved);
    if (id === null) return;
    const swap = (list: Doc[]) => list.map((d) => (idJson(d) === id ? saved : d));
    fullDocs = swap(fullDocs);
    docs = swap(docs);
  }

  return {
    get statementText() { return statementText; },
    set statementText(v: string) { statementText = v; recipeDirty = true; },
    get docs() { return docs; },
    get visibleIndices() { return visibleIndices; },
    get columnFields() { return columnFields; },
    get searchTerm() { return quickSearch.searchTerm; },
    set searchTerm(v: string) { quickSearch.searchTerm = v; },
    get searchInvalid() { return quickSearch.searchInvalid; },
    get consoleEntries() { return consoleEntries; },
    get lastElapsedMs() { return lastElapsedMs; },
    clearConsole,
    get displayMode() { return displayModeVal; },
    get valueJson() { return valueJson; },
    get ackJson() { return ackJson; },
    get capped() { return capped; },
    get error() { return error; },
    get running() { return running; },
    get loading() { return loading; },
    get provenance() { return provenance; },
    get currentPage() { return page; },
    get pageCount() { return pgCount; },
    get totalCount() { return totalCount; },
    get pageSize() { return pageSize; },
    get allShown() { return showingAll; },
    get colWidths() { return colWidths; },
    get canExplain() { return isExplainable(); },
    get explainSummary() { return explainSummary; },
    get explainRawJson() { return explainRawJson; },
    get explainPrevSummary() { return explainPrevSummary; },
    get explainLoading() { return explainLoading; },
    get explainError() { return explainError; },
    get indexSuggestion() { return indexSuggestion; },
    get explainRequestSeq() { return explainRequestSeq; },
    ensureExplain,
    showExplain,
    explainAfterRun,
    runExplain,
    createSuggestedIndex,
    get destructiveConfirm() { return destructiveConfirm; },
    get criticalConfirm() { return criticalConfirm; },
    get sessionId() { return sessionId; },
    get pendingSessionSwitch() { return pendingSessionSwitch; },
    confirmSessionSwitch,
    cancelSessionSwitch,
    rebindSession,
    run: (db: string | null, intendedSessionId?: string) => run(db, undefined, intendedSessionId),
    confirmRun,
    cancelConfirm,
    dontAskAgain,
    confirmCritical,
    cancelCritical,
    cancel,
    runSelection,
    setSelection,
    fieldsFor,
    get hasSelection() { return hasSelection; },
    goToPage,
    nextPage,
    prevPage,
    firstPage,
    lastPage,
    setPageSize,
    requestShowAll: showAll.requestShowAll,
    confirmShowAll: showAll.confirmShowAll,
    cancelShowAll: showAll.cancelShowAll,
    get showAllPending() { return showAll.showAllPending; },
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
    get editing() { return edit.editing; },
    get editText() { return edit.editText; },
    set editText(v: string) { edit.editText = v; },
    get editTextLoading() { return edit.editTextLoading; },
    get editError() { return edit.editError; },
    get saving() { return commitFlow.saving; },
    get editBlurPending() { return editBlur.editBlurPending; },
    onEditBlur,
    confirmBlurEdit,
    discardBlurEdit,
    startEdit,
    commitEdit: commitFlow.commitEdit,
    cancelEdit,
    get selected() { return selection.selected; },
    get menu() { return selection.menu; },
    replaceDoc,
    fullDocFor,
    clickRow: selection.clickRow,
    setSelected: selection.setSelected,
    invertSelection: selection.invertSelection,
    openMenu: selection.openMenu,
    closeMenu: selection.closeMenu,
    menuItems,
    onMenuSelect,
    get ioError() { return ioError; },
    /** The selection delete waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
    get exportRequest() { return exportRequest; },
    cancelExport,
    exportInput,
    get canEditSelected() { return getSelectedForEdit() !== null; },
    get canDeleteSelected() {
      return isEditable() && selection.selected.size > 0 &&
        [...selection.selected].every((r) => { const d = docs[r]; return d ? idJson(d) !== null : false; });
    },
    getSelectedForEdit,
    requestDeleteSelected,
    requestExportCurrent,
  };
}
