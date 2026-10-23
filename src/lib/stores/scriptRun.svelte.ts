import { runScript, cancelScript } from "../api/script";
import type { ConsoleEntry } from "../api/script";
import { rafThrottle } from "../domain/rafThrottle";
import { queryPage, aggregate, aggregateCount, countDocuments } from "../api/documents";
import { displayMode as computeDisplayMode, parseRows } from "../domain/scriptOutcome";
import { mergeColumns } from "../domain/schema";
import { computeColumnWidths } from "../domain/colwidth";
import { pageCount, clampPage, skipFor, pageSlice } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { scanDestructive, scanCritical, withLoadedSnippets } from "../domain/scriptScan";
import { queryLibrary } from "./queryLibrary.svelte";
import { errorMessage } from "../api/errors";
import { canSuppress } from "../domain/confirmPolicy";
import type { HistoryEntry } from "../domain/queryHistory";
import * as m from "#lib/paraglide/messages.js";
import { settings } from "./settings.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { createShowAllFlow } from "./showAllFlow.svelte";
import { sessionEnvironment, sessionMeta } from "./sessionEnv";
import { queryHistory } from "./queryHistory.svelte";
import type { createRowSelection } from "./rowSelection.svelte";
import type { ScriptResult, PagedRecipe, ResultSnapshot } from "./scriptResult.svelte";
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
        : await fetchPagedPage(rc, rc.baseSkip + skipFor(r.page, r.pageSize), r.pageSize);
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
  let previewStash: ResultSnapshot | null = null;
  let previewLabel = $state<{ stage: number; of: number } | null>(null);

  function showPreview(rows: Doc[], label: { stage: number; of: number }) {
    if (!previewStash) previewStash = r.snapshot();
    r.bumpGeneration();
    selection.clearSelection();
    r.recipe = null;
    r.clearData();
    r.setStatic(rows);
    r.displayModeVal = "grid-readonly";
    r.pageReq = 1;
    previewLabel = label;
  }

  function clearPreview() {
    const s = previewStash;
    if (!s) return;
    previewStash = null;
    previewLabel = null;
    r.bumpGeneration();
    selection.clearSelection();
    r.restore(s);
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

      r.clearData();
      const res = outcome.result;
      if (res.kind === "docs") {
        r.setStatic(parseRows(res.rows));
        r.provenance = outcome.provenance;
        r.capped = outcome.capped;
      } else if (res.kind === "cursorQuery") {
        const rc: PagedRecipe = {
          cursorKind: res.cursorKind, db: res.db, coll: res.coll, query: res.query,
          sort: res.sort, projection: res.projection, baseSkip: res.baseSkip, fixedLimit: res.fixedLimit,
        };
        r.recipe = rc;
        explain.recipeDirty = false;
        r.provenance = { db: res.db, coll: res.coll };
        if (rc.fixedLimit === null) {
          // Page 1 does not depend on the total: count and fetch together.
          const gen = r.generation;
          const [count] = await Promise.allSettled([countPaged(rc), loadPagedCurrentPage()]);
          if (count.status === "rejected") throw count.reason;
          if (gen !== r.generation) return;
          r.totalCount = count.value;
        } else {
          await loadPagedCurrentPage();
        }
      } else if (res.kind === "value") {
        r.valueJson = res.json;
      } else if (res.kind === "ack") {
        r.ackJson = res.json;
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
    else r.docs = pageSlice(r.fullDocs, r.page, r.pageSize);
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
