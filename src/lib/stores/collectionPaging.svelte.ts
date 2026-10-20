import * as m from "#lib/paraglide/messages.js";
import { queryPage, countDocuments } from "../api/documents";
import { errorMessage } from "../api/errors";
import { pageCount, clampPage, skipFor } from "../domain/paging";
import { buildSort, buildProjection, type SortKey } from "../domain/grid";
import { findCmd } from "../domain/mongosh";
import type { Doc } from "../domain/doc";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";

/** What the paging block needs from the owning collection view (all read lazily). */
export interface CollectionPagingCtx {
  sessionId: string;
  db: string;
  coll: string;
  getAppliedFilter: () => string;
  getSortKeys: () => SortKey[];
  getHidden: () => Set<string>;
  /** Current race-guard value; in-flight loads capture it and bail out when it moves. */
  currentGeneration: () => number;
  bumpGeneration: () => number;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  /** Installs a freshly loaded page (pending overlay, columns, widths, selection reset). */
  applyDocs: (batch: Doc[]) => void;
}

/** Page size / current page / total count for one collection view, and the loads that move between pages. */
export function createCollectionPaging(ctx: CollectionPagingCtx) {
  const { sessionId, db, coll } = ctx;
  let pageSize = $state(50);
  let currentPage = $state(1);
  let totalCount = $state(0);
  const pgCount = $derived(pageCount(totalCount, pageSize));

  let allShown = $state(false);
  let lastQueryMs = $state<number | null>(null);

  /** Load the current page (replaces docs). */
  async function loadPage() {
    ctx.setLoading(true);
    allShown = false;
    ctx.setError(null);
    const gen = ctx.currentGeneration();
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
        ctx.getAppliedFilter(),
        buildSort(ctx.getSortKeys()),
        buildProjection(ctx.getHidden()),
        settings.queryTimeoutMs,
      );
      if (gen !== ctx.currentGeneration()) return;
      lastQueryMs = Date.now() - startedAt;
      commandLog.push(
        findCmd({
          coll,
          filter: ctx.getAppliedFilter(),
          projection: buildProjection(ctx.getHidden()),
          sort: buildSort(ctx.getSortKeys()),
          skip,
          limit: pageSize,
        }),
        sessionId,
        lastQueryMs,
      );
      ctx.applyDocs(batch);
    } catch (e) {
      if (gen !== ctx.currentGeneration()) return;
      ctx.setError(errorMessage(e));
    } finally {
      if (gen === ctx.currentGeneration()) ctx.setLoading(false);
      activity.end();
    }
  }

  /** Page 1 needs no clamping, so the count (slow on big collections) runs alongside the page fetch instead of gating it. */
  async function loadFirstPage() {
    currentPage = 1;
    await Promise.all([refreshCount(), loadPage()]);
  }

  /** Recount documents under the active filter and clamp currentPage; every caller follows this with loadPage(), which owns clearing `loading`. */
  async function refreshCount() {
    ctx.setLoading(true);
    const gen = ctx.currentGeneration();
    activity.begin(m.status_bar_loading());
    try {
      const n = await countDocuments(sessionId, db, coll, ctx.getAppliedFilter(), settings.queryTimeoutMs);
      if (gen !== ctx.currentGeneration()) return;
      totalCount = n;
      currentPage = clampPage(currentPage, pageCount(totalCount, pageSize));
    } catch (e) {
      if (gen !== ctx.currentGeneration()) return;
      ctx.setError(errorMessage(e));
    } finally {
      activity.end();
    }
  }

  async function goToPage(n: number) {
    const target = clampPage(n, pgCount);
    currentPage = target;
    ctx.bumpGeneration();
    await loadPage();
  }

  async function setPageSize(n: number) {
    pageSize = Math.max(1, Math.floor(n) || 50);
    ctx.bumpGeneration();
    currentPage = 1;
    await loadPage();
  }

  return {
    get pageSize() { return pageSize; },
    get currentPage() { return currentPage; },
    get totalCount() { return totalCount; },
    get pageCount() { return pgCount; },
    get allShown() { return allShown; },
    set allShown(v: boolean) { allShown = v; },
    get lastQueryMs() { return lastQueryMs; },
    set lastQueryMs(v: number | null) { lastQueryMs = v; },
    loadPage,
    loadFirstPage,
    refreshCount,
    goToPage,
    setPageSize,
    nextPage: () => goToPage(currentPage + 1),
    prevPage: () => goToPage(currentPage - 1),
    firstPage: () => goToPage(1),
    lastPage: () => goToPage(pgCount),
  };
}
