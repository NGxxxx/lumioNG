import { runScript, cancelScript } from "../api/script";
import type { ConsoleEntry } from "../api/script";
import { rafThrottle } from "../domain/rafThrottle";
import { queryPage, aggregate, aggregateCount, countDocuments } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows, type DisplayMode } from "../domain/scriptOutcome";
import { mergeColumns, type ColumnField } from "../domain/schema";
import { computeColumnWidths } from "../domain/colwidth";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive, scanCritical, withLoadedSnippets } from "../domain/scriptScan";
import { queryLibrary } from "./queryLibrary.svelte";
import { errorMessage } from "../api/errors";
import { canSuppress } from "../domain/confirmPolicy";
import type { HistoryEntry } from "../domain/queryHistory";
import type { Provenance } from "../api/script";
import * as m from "#lib/paraglide/messages.js";
import { settings } from "./settings.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { createShowAllFlow } from "./showAllFlow.svelte";
import { sessionEnvironment, sessionMeta } from "./sessionEnv";
import { queryHistory } from "./queryHistory.svelte";
import type { createRowSelection } from "./rowSelection.svelte";
import type { ScriptResult, PagedRecipe } from "./scriptResult.svelte";
import type { createScriptExplain } from "./scriptExplain.svelte";

/** What the run block needs from the owning query tab (all read lazily). */
export interface ScriptRunCtx {
  getSessionId: () => string;
  result: ScriptResult;
  selection: ReturnType<typeof createRowSelection>;
  explain: ReturnType<typeof createScriptExplain>;
  tabId: number | null;
  getStatementText: () => string;
  guardSessionSwitch: (intendedSessionId: string | undefined, retry: () => Promise<void>) => boolean;
}

/** Running a script (confirm gates, history), fetching/paging its result, and the builder preview of one Query tab. */
export function createScriptRun(ctx: ScriptRunCtx) {
  const r = ctx.result;
  const selection = ctx.selection;
  const explain = ctx.explain;

  let destructiveConfirm = $state<{ ops: string[]; /** PROD: cannot be suppressed, says so. */ prod: boolean } | null>(null);
  /** Critical-tier destructive ops (dropDatabase/drop/dropIndex(es), or an empty-filter mass
   *  write) — always confirmed via typed name, bypassing `settings.suppressDestructiveWarning`. */
  let criticalConfirm = $state<{ ops: string[] } | null>(null);
  // `sessionId` is the session the confirm was raised for: the run only goes ahead on that same session.
  let pending: { db: string; script: string; sessionId: string } | null = null;

  /** Fetch one page directly from Rust for a "paged" recipe — bypasses QuickJS entirely. */
  async function fetchPagedPage(rc: PagedRecipe, skip: number, limit: number): Promise<Doc[]> {
    const sessionId = ctx.getSessionId();
    return rc.cursorKind === "agg"
      ? await aggregate(sessionId, rc.db, rc.coll, rc.query, skip, limit, settings.queryTimeoutMs)
      : await queryPage(sessionId, rc.db, rc.coll, skip, limit, rc.query, rc.sort, rc.projection, settings.queryTimeoutMs);
  }

  /** Total count for a "paged" recipe (the full match, ignoring the recipe's own skip/limit). */
  async function countPaged(rc: PagedRecipe): Promise<number> {
    const sessionId = ctx.getSessionId();
    activity.begin(m.status_bar_running_query());
    try {
      return rc.cursorKind === "agg"
        ? await aggregateCount(sessionId, rc.db, rc.coll, rc.query, settings.queryTimeoutMs)
        : await countDocuments(sessionId, rc.db, rc.coll, rc.query, settings.queryTimeoutMs);
    } finally {
      activity.end();
    }
  }

  /** Load the current page in "paged" mode; recomputes columns from THIS page only (accepted tradeoff, avoids an extra schema-sampling round-trip). No-op in "static" mode. */
  async function loadPagedCurrentPage() {
    if (!r.recipe) return;
    const rc = r.recipe;
    const gen = r.generation;
    r.loading = true;
    activity.begin(m.status_bar_running_query());
    try {
      const result = rc.fixedLimit !== null
        ? await fetchPagedPage(rc, rc.baseSkip, rc.fixedLimit)
        : await fetchPagedPage(rc, rc.baseSkip + (r.page - 1) * r.pageSize, r.pageSize);
      if (gen !== r.generation) return;
      r.docs = result;
      if (rc.fixedLimit !== null) r.totalCount = r.docs.length;
      r.rawColumnFields = mergeColumns(null, r.docs);
      r.defaultColWidths = computeColumnWidths(r.columnFields, r.docs);
      r.colWidths = { ...r.defaultColWidths };
    } catch (e) {
      if (gen !== r.generation) return;
      r.error = errorMessage(e);
    } finally {
      if (gen === r.generation) r.loading = false;
      activity.end();
    }
  }

  // ── Builder preview (spec §1.3): the selected stage's sample temporarily replaces the result;
  // the run's own result is stashed and comes back on clearPreview (never by re-running). ──
  type ResultSnapshot = {
    fullDocs: Doc[]; docs: Doc[]; rawColumnFields: ColumnField[]; colWidths: Record<string, number>;
    defaultColWidths: Record<string, number>; displayModeVal: DisplayMode; provenance: Provenance | null;
    totalCount: number; recipe: PagedRecipe | null; pageReq: number; capped: boolean; valueJson: string | null; ackJson: string | null;
  };
  let previewStash: ResultSnapshot | null = null;
  let previewLabel = $state<{ stage: number; of: number } | null>(null);

  function showPreview(rows: Doc[], label: { stage: number; of: number }) {
    if (!previewStash) {
      previewStash = {
        fullDocs: r.fullDocs, docs: r.docs, rawColumnFields: r.rawColumnFields, colWidths: r.colWidths,
        defaultColWidths: r.defaultColWidths, displayModeVal: r.displayModeVal, provenance: r.provenance,
        totalCount: r.totalCount, recipe: r.recipe, pageReq: r.pageReq, capped: r.capped, valueJson: r.valueJson, ackJson: r.ackJson,
      };
    }
    r.bumpGeneration();
    selection.clearSelection();
    r.recipe = null;
    r.fullDocs = rows;
    r.docs = rows.slice(0, r.pageSize);
    r.rawColumnFields = mergeColumns(null, rows);
    r.defaultColWidths = computeColumnWidths(r.columnFields, rows);
    r.colWidths = { ...r.defaultColWidths };
    r.displayModeVal = "grid-readonly";
    r.provenance = null;
    r.totalCount = rows.length;
    r.pageReq = 1;
    r.capped = false;
    r.valueJson = null;
    r.ackJson = null;
    previewLabel = label;
  }

  function clearPreview() {
    const s = previewStash;
    if (!s) return;
    previewStash = null;
    previewLabel = null;
    r.bumpGeneration();
    selection.clearSelection();
    r.fullDocs = s.fullDocs; r.docs = s.docs; r.rawColumnFields = s.rawColumnFields; r.colWidths = s.colWidths;
    r.defaultColWidths = s.defaultColWidths; r.displayModeVal = s.displayModeVal; r.provenance = s.provenance;
    r.totalCount = s.totalCount; r.recipe = s.recipe; r.pageReq = s.pageReq; r.capped = s.capped;
    r.valueJson = s.valueJson; r.ackJson = s.ackJson;
  }

  /** `confirmed`: the user passed the destructive/critical gate for this run; Rust requires it before a PROD load() may run destructive snippet code. */
  async function execute(db: string, script: string, confirmed: boolean) {
    staleAfterUndo = false;
    previewStash = null;
    previewLabel = null;
    r.running = true;
    r.error = null;
    selection.clearSelection();
    selection.closeMenu();
    r.showingAll = false;
    r.pageReq = 1;
    r.recipe = null;
    explain.reset();
    showAll.cancelShowAll();
    r.bumpGeneration(); // invalidate any still in-flight paged fetch (and drop any open cell edit) from before this fresh run
    const startedAt = Date.now();
    activity.begin(m.status_bar_running_query());
    // Printed lines arrive while the script runs. `consoleEntries` is `$state.raw`, so lines are buffered
    // and appended in one reassignment per animation frame (up to 1,000 lines/s must not mean 1,000 reassignments).
    r.consoleEntries = [];
    let buffered: ConsoleEntry[] = [];
    let streaming = true;
    const flushOutput = () => {
      if (!buffered.length) return;
      r.consoleEntries = [...r.consoleEntries, ...buffered];
      buffered = [];
    };
    const scheduleFlush = rafThrottle(flushOutput);
    try {
      const outcome = await runScript(ctx.getSessionId(), db, script, {
        timeoutMs: settings.queryTimeoutMs,
        cap: settings.queryResultCapUnlimited ? 0 : settings.queryResultCap,
        confirmed,
        onOutput: (entry) => {
          if (!streaming) return;
          buffered.push(entry);
          scheduleFlush();
        },
      });
      streaming = false;
      scheduleFlush.cancel();
      commandLog.push(script, ctx.getSessionId(), Date.now() - startedAt);

      r.consoleEntries = outcome.console; // authoritative: the same lines the stream delivered
      explain.explainHint = outcome.explainHint ?? null;
      r.displayModeVal = computeDisplayMode(outcome);

      if (outcome.result.kind === "docs") {
        r.fullDocs = parseRows(outcome.result.rows);
        r.docs = r.fullDocs.slice(0, r.pageSize);
        r.rawColumnFields = mergeColumns(null, r.fullDocs);
        r.defaultColWidths = computeColumnWidths(r.columnFields, r.fullDocs);
        r.colWidths = { ...r.defaultColWidths };
        r.provenance = outcome.provenance;
        r.totalCount = r.fullDocs.length;
        r.capped = outcome.capped;
        r.valueJson = null;
        r.ackJson = null;
      } else if (outcome.result.kind === "cursorQuery") {
        const c = outcome.result;
        r.recipe = {
          cursorKind: c.cursorKind, db: c.db, coll: c.coll, query: c.query,
          sort: c.sort, projection: c.projection, baseSkip: c.baseSkip, fixedLimit: c.fixedLimit,
        };
        explain.recipeDirty = false;
        r.fullDocs = [];
        r.docs = [];
        r.rawColumnFields = [];
        r.provenance = { db: c.db, coll: c.coll };
        r.capped = false;
        r.valueJson = null;
        r.ackJson = null;
        if (r.recipe.fixedLimit === null) {
          const gen = r.generation;
          const total = await countPaged(r.recipe);
          if (gen !== r.generation) return;
          r.totalCount = total;
        }
        await loadPagedCurrentPage();
      } else if (outcome.result.kind === "value") {
        r.valueJson = outcome.result.json;
        r.docs = [];
        r.fullDocs = [];
        r.rawColumnFields = [];
        r.provenance = null;
        r.capped = false;
        r.totalCount = 0;
        r.ackJson = null;
      } else if (outcome.result.kind === "ack") {
        r.ackJson = outcome.result.json;
        r.docs = [];
        r.fullDocs = [];
        r.rawColumnFields = [];
        r.provenance = null;
        r.capped = false;
        r.totalCount = 0;
        r.valueJson = null;
      } else {
        // kind === "none"
        r.docs = [];
        r.fullDocs = [];
        r.rawColumnFields = [];
        r.provenance = null;
        r.capped = false;
        r.totalCount = 0;
        r.valueJson = null;
        r.ackJson = null;
      }

      r.error = outcome.error;
    } catch (e) {
      streaming = false;
      scheduleFlush.cancel();
      flushOutput(); // keep what was printed before the failure
      r.error = errorMessage(e);
    } finally {
      r.lastElapsedMs = Date.now() - startedAt;
      r.running = false;
      activity.end();
      recordHistory(db, script, r.lastElapsedMs);
    }
  }

  /** Every user-started run goes to the query history (builder previews and counts never do). */
  function recordHistory(db: string, script: string, ms: number) {
    const meta = sessionMeta(ctx.getSessionId());
    let outcome: HistoryEntry["outcome"];
    if (r.error) outcome = { kind: "error", message: r.error.split("\n")[0] };
    else if (r.displayModeVal === "ack") outcome = { kind: "modified", n: ackCount(r.ackJson) };
    else outcome = { kind: "docs", n: r.totalCount };
    queryHistory.record({ tabId: ctx.tabId, sessionLabel: meta.label, connId: meta.connId, db, script, at: Date.now(), ms, outcome });
  }

  function ackCount(json: string | null): number | undefined {
    try {
      const a = JSON.parse(json ?? "null") as Record<string, unknown> | null;
      for (const k of ["modifiedCount", "deletedCount", "insertedCount", "upsertedCount", "nModified", "n"]) {
        const v = a?.[k];
        if (typeof v === "number") return v;
        if (v && typeof v === "object" && typeof (v as Record<string, unknown>).$numberInt === "string") return Number((v as Record<string, string>).$numberInt);
      }
    } catch {
      // unknown ack shape
    }
    return undefined;
  }

  function clearConsole() {
    r.consoleEntries = [];
  }

  // An undo changed documents behind a non-paged script result: say so rather than re-run a script
  // that might write.
  let staleAfterUndo = $state(false);

  /** An undo wrote to `change`'s collection: a paged read result reloads its page; any other result
   *  showing that collection is flagged stale. */
  function syncAfterUndo(change: { sessionId: string; db: string; coll: string } | null) {
    if (!change || change.sessionId !== ctx.getSessionId() || !r.provenance) return;
    if (change.db !== r.provenance.db || change.coll !== r.provenance.coll) return;
    if (r.recipe) void refreshResults();
    else staleAfterUndo = true;
  }

  async function run(db: string | null, script: string = ctx.getStatementText(), intendedSessionId?: string) {
    if (ctx.guardSessionSwitch(intendedSessionId, () => run(db, script, intendedSessionId))) return;
    if (!db) {
      r.error = m.query_tab_select_db_first();
      return;
    }
    // Snippets pulled in by load("name") are not in the editor, but they run with the same rights: scan them too.
    // A load() that can't be traced to a known snippet (dynamic, aliased, library not loaded or errored) counts as destructive.
    const libraryReady = queryLibrary.loaded && !queryLibrary.loadError;
    const { text: scanned, unresolved } = withLoadedSnippets(script, (name) => {
      if (!libraryReady) return undefined;
      const q = queryLibrary.nodes.find((n) => n.kind === "query" && n.name === name);
      return q?.kind === "query" ? q.statement : undefined;
    });
    const critical = scanCritical(scanned);
    if (critical.length) {
      pending = { db, script, sessionId: ctx.getSessionId() };
      criticalConfirm = { ops: critical };
      return;
    }
    const ops = scanDestructive(scanned);
    if (unresolved) ops.push("load");
    // "Don't ask again" never applies on PROD.
    const prod = !canSuppress(sessionEnvironment(ctx.getSessionId()), "script");
    if (ops.length && (prod || !settings.suppressDestructiveWarning)) {
      pending = { db, script, sessionId: ctx.getSessionId() };
      destructiveConfirm = { ops, prod };
      return;
    }
    await execute(db, script, false);
  }

  async function confirmRun() {
    const p = pending;
    destructiveConfirm = null;
    pending = null;
    await executeConfirmed(p);
  }

  /** Runs a confirmed script, unless the active session changed while the confirm was open (the user
   *  agreed to run it on the other session, possibly a different environment). */
  async function executeConfirmed(p: { db: string; script: string; sessionId: string } | null) {
    if (!p) return;
    if (p.sessionId !== ctx.getSessionId()) {
      r.error = m.script_confirm_session_changed();
      return;
    }
    await execute(p.db, p.script, true);
  }

  function cancelConfirm() {
    destructiveConfirm = null;
    pending = null;
  }

  async function confirmCritical() {
    const p = pending;
    criticalConfirm = null;
    pending = null;
    await executeConfirmed(p);
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
    cancelScript(ctx.getSessionId());
  }

  /** Show ALL: totalCount is already fetched right after execute() (both "paged" and "static"
   *  modes), so the shared flow gates off it directly instead of re-counting — avoids a redundant
   *  round-trip. `showingAll` only flips once the rows are actually in hand, so a superseded or
   *  failed fetch leaves the pager exactly as it was. */
  const showAll = createShowAllFlow({
    getTotalCount: () => r.totalCount,
    bumpGeneration: r.bumpGeneration,
    currentGeneration: () => r.generation,
    canShowAll: () => !(r.recipe && r.recipe.fixedLimit !== null), // fixed-limit results have no show-all
    setError: (msg) => { r.error = msg; },
    setLoading: (v) => { r.loading = v; },
    load: async (stale) => {
      if (!r.recipe) {
        r.docs = r.fullDocs; // already fully materialized (static mode) — instant, no round-trip
        r.showingAll = true;
        return;
      }
      const rc = r.recipe;
      const result = await fetchPagedPage(rc, rc.baseSkip, r.totalCount);
      if (stale()) return;
      r.docs = result;
      r.fullDocs = r.docs;
      r.showingAll = true;
    },
  });

  async function goToPage(p: number) {
    if (r.recipe && r.recipe.fixedLimit !== null) return; // fixed-limit results have no pager
    r.showingAll = false; // every page-navigation action unconditionally exits show-all mode
    r.pageReq = clampPage(p, r.pgCount);
    r.bumpGeneration();
    if (r.recipe) await loadPagedCurrentPage();
    else r.docs = r.fullDocs.slice((r.page - 1) * r.pageSize, (r.page - 1) * r.pageSize + r.pageSize);
  }

  /** In-place reload of the current page (same recipe query): recount + refetch. Only meaningful
   *  for a pure paged cursor result — a materialized/static result (script had .map()/writes/no
   *  single query left to re-run) has nothing safe to re-fetch, so callers must gate on `recipe`. */
  async function refreshResults() {
    if (!r.recipe) return;
    const rc = r.recipe;
    const gen = r.bumpGeneration();
    if (rc.fixedLimit === null) {
      const total = await countPaged(rc);
      if (gen !== r.generation) return;
      r.totalCount = total;
      r.pageReq = clampPage(r.page, pageCount(r.totalCount, r.pageSize));
    }
    await loadPagedCurrentPage();
  }

  async function setPageSize(n: number) {
    if (r.recipe && r.recipe.fixedLimit !== null) return;
    r.showingAll = false; // changing page size always exits show-all mode
    r.pageSize = Math.max(1, Math.floor(n) || 50);
    r.pageReq = 1;
    r.bumpGeneration();
    if (r.recipe) await loadPagedCurrentPage();
    else r.docs = r.fullDocs.slice(0, r.pageSize);
  }

  return {
    get destructiveConfirm() { return destructiveConfirm; },
    get criticalConfirm() { return criticalConfirm; },
    get previewLabel() { return previewLabel; },
    get staleAfterUndo() { return staleAfterUndo; },
    showAll,
    countPaged,
    loadPagedCurrentPage,
    refreshResults,
    showPreview,
    clearPreview,
    clearConsole,
    syncAfterUndo,
    run,
    confirmRun,
    cancelConfirm,
    dontAskAgain,
    confirmCritical,
    cancelCritical,
    cancel,
    goToPage,
    setPageSize,
    nextPage: () => goToPage(r.page + 1),
    prevPage: () => goToPage(r.page - 1),
    firstPage: () => goToPage(1),
    lastPage: () => goToPage(r.pgCount),
  };
}
