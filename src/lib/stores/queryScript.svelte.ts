import { untrack } from "svelte";
import { runScript, cancelScript, type ConsoleEntry, type Provenance } from "../api/script";
import { sampleDocuments, queryPage, aggregate, aggregateCount, countDocuments, explainQuery } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows, type DisplayMode } from "../domain/scriptOutcome";
import { mergeColumns, inferSchema, getByPath, type ColumnField } from "../domain/schema";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive } from "../domain/scriptScan";
import { compileSearch, matchingIndices } from "../domain/search";
import { settings } from "./settings.svelte";
import { updateOne, deleteMany } from "../api/documents";
import { createIndex } from "../api/indexes";
import { summarizeExplain, type ExplainSummary } from "../domain/explainPlan";
import { suggestIndex, type IndexSuggestion } from "../domain/indexAdvisor";
import { idJson } from "../domain/docid";
import { describeValue } from "../domain/extjson";
import { isInlineEditable, editTextOf, rebuildValue, buildSetUpdate, setByPath } from "../domain/celledit";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { updateOneCmd, deleteManyCmd } from "../domain/mongosh";
import * as m from "$lib/paraglide/messages";
import { idInFilter, effectiveRows as effectiveRowsOf, clickRowSelection, selectForMenu } from "../domain/selection";
import { toJsonArray, toCsv } from "../domain/exporter";
import type { ExportWizardInput } from "../domain/exportPlan";
import type { MenuItem } from "../domain/gridView";

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
  /** True once the editor is touched after the run that produced `recipe`, so Explain knows to re-run instead of silently reusing a stale plan. */
  let recipeDirty = $state(false);

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

  let columnFields = $state<ColumnField[]>([]);
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});

  // Client-side quick search (HeidiSQL-style): filters the current in-memory result set in place, no server round-trip.
  let searchTerm = $state("");
  const searchRegex = $derived(compileSearch(searchTerm));
  const searchInvalid = $derived(searchTerm !== "" && searchRegex === null);
  const visibleIndices = $derived(matchingIndices(docs, columnFields, searchRegex));

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
  const SHOW_ALL_WARN_THRESHOLD = 5000;
  let showAllPending = $state<number | null>(null);
  // Guards against overlapping in-flight paged-mode fetches (double-click nextPage, fast page-jump typing, etc.), same pattern as collectionView.svelte.ts.
  let generation = 0;

  let destructiveConfirm = $state<{ ops: string[] } | null>(null);
  let pending: { db: string; script: string } | null = null;

  // Inline cell edit (row index is relative to the CURRENT PAGE's `docs`, in both modes).
  let editing = $state<{ row: number; key: string } | null>(null);
  let editText = $state("");
  let editError = $state<string | null>(null);
  let saving = $state(false);

  // Row selection (indices into the current page's `docs`).
  let selected = $state<Set<number>>(new Set());
  let anchor: number | null = null;
  let menu = $state<{ x: number; y: number; row: number; key: string } | null>(null);
  let ioError = $state<string | null>(null);
  let confirmDelete = $state<{ count: number; picked: Doc[] } | null>(null);
  let exportRequest = $state<{ rows: Doc[] } | null>(null);

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
        const sampledDocs = await sampleDocuments(sessionId, db, coll, "{}", 50, settings.queryTimeoutMs);
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

  // Editor selection range (chars into statementText), kept in sync by the textarea; enables "Run selection".
  let selStart = $state(0);
  let selEnd = $state(0);
  const hasSelection = $derived(selStart !== selEnd && statementText.slice(selStart, selEnd).trim().length > 0);

  function setSelection(start: number, end: number) {
    selStart = start;
    selEnd = end;
  }

  const indexSuggestion = $derived(
    recipe && explainSummary?.verdict === "collscan"
      ? suggestIndex(recipe.coll, recipe.query, recipe.sort)
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
      columnFields = mergeColumns(null, docs);
      defaultColWidths = computeColumnWidths(columnFields, docs);
      colWidths = { ...defaultColWidths };
    } catch (e) {
      if (gen !== generation) return;
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === generation) loading = false;
      activity.end();
    }
  }

  async function runExplain(): Promise<void> {
    if (!recipe) return;
    const r = recipe;
    const gen = generation;
    explainLoading = true;
    explainError = null;
    activity.begin(m.status_bar_running_query());
    try {
      const json = await explainQuery(
        sessionId, r.cursorKind, r.db, r.coll, r.query, r.sort, r.projection, r.baseSkip, r.fixedLimit,
        settings.queryTimeoutMs,
      );
      if (gen !== generation) return; // a fresh run superseded this in-flight explain — discard it
      explainRawJson = json;
      explainSummary = summarizeExplain(JSON.parse(json));
    } catch (e) {
      if (gen !== generation) return;
      explainError = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === generation) explainLoading = false;
      activity.end();
    }
  }

  function isExplainable(): boolean {
    return recipe !== null && !recipeDirty;
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
  async function explainAfterRun(db: string | null): Promise<void> {
    if (!isExplainable()) {
      await run(db);
    }
    if (recipe) {
      showExplain();
    }
  }

  async function createSuggestedIndex(): Promise<void> {
    if (!recipe || !indexSuggestion || !explainSummary) return;
    const r = recipe;
    const suggestion = indexSuggestion;
    const prev = explainSummary;
    const gen = generation;
    try {
      await commandLog.pushTimed(suggestion.snippet, sessionId, () =>
        createIndex(sessionId, r.db, r.coll, JSON.stringify(suggestion.keys), false, null));
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
    selected = new Set();
    anchor = null;
    menu = null;
    editing = null;
    showingAll = false;
    pageReq = 1;
    recipe = null;
    explainSummary = null;
    explainRawJson = null;
    explainPrevSummary = null;
    explainLoading = false;
    explainError = null;
    showAllPending = null;
    generation++; // invalidate any still in-flight paged fetch from before this fresh run
    const startedAt = Date.now();
    activity.begin(m.status_bar_running_query());
    try {
      const outcome = await runScript(sessionId, db, script, {
        timeoutMs: settings.queryTimeoutMs,
        cap: settings.queryResultCapUnlimited ? 0 : settings.queryResultCap,
      });
      commandLog.push(script, sessionId, Date.now() - startedAt);

      consoleEntries = outcome.console;
      displayModeVal = computeDisplayMode(outcome);

      if (outcome.result.kind === "docs") {
        fullDocs = parseRows(outcome.result.rows);
        docs = fullDocs.slice(0, pageSize);
        columnFields = mergeColumns(null, fullDocs);
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
        columnFields = [];
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
        columnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        ackJson = null;
      } else if (outcome.result.kind === "ack") {
        ackJson = outcome.result.json;
        docs = [];
        fullDocs = [];
        columnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        valueJson = null;
      } else {
        // kind === "none"
        docs = [];
        fullDocs = [];
        columnFields = [];
        provenance = null;
        capped = false;
        totalCount = 0;
        valueJson = null;
        ackJson = null;
      }

      error = outcome.error;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      lastElapsedMs = Date.now() - startedAt;
      running = false;
      activity.end();
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

  async function dontAskAgain() {
    settings.setSuppressDestructiveWarning(true);
    await confirmRun();
  }

  function cancel() {
    cancelScript(sessionId);
  }

  /** Run only the highlighted text (falls back to the whole statement if nothing is selected). */
  function runSelection(db: string | null) {
    const stmt = hasSelection ? statementText.slice(selStart, selEnd) : statementText;
    return run(db, stmt);
  }

  /** Show ALL: totalCount is already fetched right after execute() (both "paged" and "static"
   *  modes), so gate off it directly instead of re-counting — avoids a redundant round-trip. */
  function requestShowAll(): void | Promise<void> {
    if (recipe && recipe.fixedLimit !== null) return; // fixed-limit results have no show-all
    editing = null;
    error = null;
    if (totalCount > SHOW_ALL_WARN_THRESHOLD) {
      generation++; // invalidate any other in-flight load — this supersedes it
      showAllPending = totalCount;
      return;
    }
    return confirmShowAll();
  }

  /** Self-guarding: bumps `generation` so a second call (or any other in-flight load) discards
   *  a stale first call. */
  async function confirmShowAll() {
    showAllPending = null;
    editing = null;
    showingAll = true;
    if (recipe) {
      const r = recipe;
      generation++;
      const gen = generation;
      loading = true;
      try {
        const result = await fetchPagedPage(r, r.baseSkip, totalCount);
        if (gen !== generation) return;
        docs = result;
        fullDocs = docs;
      } catch (e) {
        if (gen !== generation) return;
        error = e instanceof Error ? e.message : String(e);
        showingAll = false;
      } finally {
        if (gen === generation) loading = false;
      }
    } else {
      docs = fullDocs; // already fully materialized (static mode) — instant, no round-trip
    }
  }

  function cancelShowAll() {
    showAllPending = null;
  }

  async function goToPage(p: number) {
    if (recipe && recipe.fixedLimit !== null) return; // fixed-limit results have no pager
    editing = null;
    showingAll = false; // every page-navigation action unconditionally exits show-all mode
    pageReq = clampPage(p, pgCount);
    generation++;
    if (recipe) await loadPagedCurrentPage();
    else docs = fullDocs.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
  }
  const nextPage = () => goToPage(page + 1);
  const prevPage = () => goToPage(page - 1);
  const firstPage = () => goToPage(1);
  const lastPage = () => goToPage(pgCount);

  async function setPageSize(n: number) {
    if (recipe && recipe.fixedLimit !== null) return;
    editing = null;
    showingAll = false; // changing page size always exits show-all mode
    pageSize = Math.max(1, Math.floor(n) || 50);
    pageReq = 1;
    generation++;
    if (recipe) await loadPagedCurrentPage();
    else docs = fullDocs.slice(0, pageSize);
  }

  function startEdit(row: number, key: string) {
    if (!isEditable()) return;
    const doc = docs[row];
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

  let editBlurPending = $state(false);

  /** Blur discards silently when nothing changed; otherwise asks for confirmation before
   *  saving (Enter still saves immediately, no confirmation). */
  function onEditBlur() {
    if (!editing || saving) return;
    const doc = docs[editing.row];
    const original = doc ? editTextOf(getByPath(doc, editing.key)) : "";
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
    if (!editing || saving || !provenance) return;
    const prov = provenance;
    const { row, key } = editing;
    const doc = docs[row];
    if (!doc) { editing = null; return; }
    const r = rebuildValue(getByPath(doc, key), editText);
    if (!r.ok) { editError = r.error; return; }
    const id = idJson(doc);
    if (id === null) { editError = m.query_run_selection_missing_id(); return; }
    const filter = `{"_id": ${id}}`;
    const update = buildSetUpdate(key, r.value);
    saving = true;
    try {
      await commandLog.pushTimed(updateOneCmd(prov.coll, filter, update), sessionId, () =>
        updateOne(sessionId, prov.db, prov.coll, filter, update, false));
      docs[row] = setByPath(docs[row], key, r.value);
      docs = [...docs];
      if (!recipe) fullDocs = fullDocs.map((d) => (idJson(d) === id ? setByPath(d, key, r.value) : d));
      editing = null;
      editError = null;
    } catch (e) {
      editError = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  function clickRow(row: number, mods: { ctrl: boolean; shift: boolean }) {
    ({ selected, anchor } = clickRowSelection({ selected, anchor }, row, mods, visibleIndices));
  }

  function openMenu(e: MouseEvent, row: number, key: string) {
    e.preventDefault(); e.stopPropagation();
    ({ selected, anchor } = selectForMenu({ selected, anchor }, row));
    menu = { x: e.clientX, y: e.clientY, row, key };
  }

  function closeMenu() { menu = null; }

  function effectiveRows(): number[] {
    return effectiveRowsOf(menu ? menu.row : null, selected);
  }

  function menuItems(): MenuItem[] {
    if (!menu) return [];
    const doc = docs[menu.row];
    const n = effectiveRows().length;
    const hasId = doc ? idJson(doc) !== null : false;
    const editable = isEditable();
    const allHaveId = effectiveRows().every((r) => { const d = docs[r]; return d ? idJson(d) !== null : false; });
    const items: MenuItem[] = [];
    if (editable) {
      items.push({ label: "Open document", action: "open", disabled: !hasId || n !== 1 });
      items.push({
        label: "Edit cell", action: "editCell",
        disabled: !doc || idJson(doc) === null
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
    const doc = docs[menu.row];
    const key = menu.key;
    const rows = effectiveRows();
    const picked = rows.map((r) => docs[r]).filter(Boolean) as Doc[];
    switch (action) {
      case "open": menu = null; return doc ? { open: doc } : null;
      case "editCell": { const r = menu.row; const k = menu.key; menu = null; startEdit(r, k); return null; }
      case "copyValue": copy(describeValue(getByPath(doc, key)).display); break;
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

  // ── activeDataView bridge: mirrors ResultTable's DataViewHandle shape, backed by `selected`/`docs` instead of collectionView's selection/paging state. ──

  /** The single selected row's doc, editable only when the result is a live grid-editable
   *  cursor (has a real db/coll `provenance`) and the doc carries an `_id`. */
  function getSelectedForEdit(): Doc | null {
    if (!isEditable() || selected.size !== 1) return null;
    const d = docs[[...selected][0]];
    return d && idJson(d) !== null ? d : null;
  }

  function requestDeleteSelected() {
    if (!isEditable()) return;
    const picked = [...selected].map((r) => docs[r]).filter(Boolean) as Doc[];
    requestDelete(picked);
  }

  /** Exports the selection if any, else every currently loaded row (matches the "Export" ->
   *  "All results" context-menu action). */
  function requestExportCurrent() {
    const picked = [...selected].map((r) => docs[r]).filter(Boolean) as Doc[];
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
    try {
      await commandLog.pushTimed(deleteManyCmd(prov.coll, filter), sessionId, () =>
        deleteMany(sessionId, prov.db, prov.coll, filter, false));
      selected = new Set();
      anchor = null;
      editing = null;
      if (recipe) {
        const r = recipe;
        generation++;
        const gen = generation;
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
    }
  }

  function cancelExport() { exportRequest = null; }

  function exportInput(): ExportWizardInput | null {
    if (!exportRequest) return null;
    const colPaths = columnFields.map((c) => ({ path: c.path, visible: true }));
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
    set statementText(v: string) { statementText = v; recipeDirty = true; },
    get docs() { return docs; },
    get visibleIndices() { return visibleIndices; },
    get columnFields() { return columnFields; },
    get searchTerm() { return searchTerm; },
    set searchTerm(v: string) { searchTerm = v; },
    get searchInvalid() { return searchInvalid; },
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
    run: (db: string | null) => run(db),
    confirmRun,
    cancelConfirm,
    dontAskAgain,
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
    requestShowAll,
    confirmShowAll,
    cancelShowAll,
    get showAllPending() { return showAllPending; },
    setColWidth: (path: string, px: number) => { colWidths = { ...colWidths, [path]: clampWidth(px) }; },
    resetColWidth: (path: string) => { colWidths = { ...colWidths, [path]: defaultColWidths[path] ?? 160 }; },
    get editing() { return editing; },
    get editText() { return editText; },
    set editText(v: string) { editText = v; },
    get editError() { return editError; },
    get editBlurPending() { return editBlurPending; },
    onEditBlur,
    confirmBlurEdit,
    discardBlurEdit,
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
    get canEditSelected() { return getSelectedForEdit() !== null; },
    get canDeleteSelected() {
      return isEditable() && selected.size > 0 &&
        [...selected].every((r) => { const d = docs[r]; return d ? idJson(d) !== null : false; });
    },
    getSelectedForEdit,
    requestDeleteSelected,
    requestExportCurrent,
  };
}
