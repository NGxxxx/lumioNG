import type { ExplainHint } from "../api/script";
import { explainQuery } from "../api/documents";
import { createIndex } from "../api/indexes";
import { summarizeExplain, type ExplainSummary } from "../domain/explainPlan";
import { suggestIndex } from "../domain/indexAdvisor";
import { errorMessage } from "../api/errors";
import * as m from "#lib/paraglide/messages.js";
import { settings } from "./settings.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import type { ScriptResult } from "./scriptResult.svelte";

/** What the explain block needs from the owning query tab (all read lazily). */
export interface ScriptExplainCtx {
  getSessionId: () => string;
  result: ScriptResult;
  guardSessionSwitch: (intendedSessionId: string | undefined, retry: () => Promise<void>) => boolean;
  run: (db: string | null, script?: string, intendedSessionId?: string) => Promise<void>;
}

/** Explain plan, its index advisor and the explain request signal of one Query tab. */
export function createScriptExplain(ctx: ScriptExplainCtx) {
  const result = ctx.result;
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

  const indexSuggestion = $derived(
    explainHint && (explainSummary?.verdict === "collscan" || explainSummary?.verdict === "ixscan-inefficient")
      ? suggestIndex(explainHint.coll, explainHint.query, explainHint.sort)
      : null,
  );

  /** A fresh run starts: forget the previous plan. */
  function reset() {
    explainHint = null;
    explainSummary = null;
    explainRawJson = null;
    explainPrevSummary = null;
    explainLoading = false;
    explainError = null;
  }

  async function runExplain(): Promise<void> {
    if (!explainHint) return;
    const r = explainHint;
    const gen = result.generation;
    explainLoading = true;
    explainError = null;
    activity.begin(m.status_bar_running_query());
    try {
      const json = await explainQuery(
        ctx.getSessionId(), r.cursorKind, r.db, r.coll, r.query, r.sort, r.projection, r.skip, r.limit,
        settings.queryTimeoutMs,
      );
      if (gen !== result.generation) return; // a fresh run superseded this in-flight explain — discard it
      explainRawJson = json;
      explainSummary = summarizeExplain(JSON.parse(json));
    } catch (e) {
      if (gen !== result.generation) return;
      explainError = errorMessage(e);
    } finally {
      if (gen === result.generation) explainLoading = false;
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
    if (ctx.guardSessionSwitch(intendedSessionId, () => explainAfterRun(db, intendedSessionId))) return;
    if (!isExplainable()) {
      await ctx.run(db, undefined, intendedSessionId);
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
    const gen = result.generation;
    const sessionId = ctx.getSessionId();
    try {
      await commandLog.pushTimed(suggestion.snippet, sessionId, () =>
        createIndex(sessionId, r.db, r.coll, JSON.stringify(suggestion.keys), false, null, false, null, null, null));
      if (gen !== result.generation) return; // a fresh run superseded this before the index finished
      explainPrevSummary = prev;
      await runExplain();
    } catch (e) {
      result.ioError = errorMessage(e);
    }
  }

  return {
    get explainHint() { return explainHint; },
    set explainHint(v: ExplainHint | null) { explainHint = v; },
    set recipeDirty(v: boolean) { recipeDirty = v; },
    get canExplain() { return isExplainable(); },
    get explainSummary() { return explainSummary; },
    get explainRawJson() { return explainRawJson; },
    get explainPrevSummary() { return explainPrevSummary; },
    get explainLoading() { return explainLoading; },
    get explainError() { return explainError; },
    get indexSuggestion() { return indexSuggestion; },
    get explainRequestSeq() { return explainRequestSeq; },
    reset,
    ensureExplain,
    showExplain,
    explainAfterRun,
    runExplain,
    createSuggestedIndex,
  };
}
