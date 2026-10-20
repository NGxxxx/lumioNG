import * as m from "#lib/paraglide/messages.js";
import { queryPage, countDocuments } from "../api/documents";
import { errorMessage } from "../api/errors";
import { pageCount, clampPage, skipFor } from "../domain/paging";
import { buildSort, buildProjection, type SortKey } from "../domain/grid";
import { planPageFetch, keysetSortDir, DEEP_SKIP_HINT_THRESHOLD } from "../domain/keyset";
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

  /** `_id` boundary of the last page we loaded, valid only for the exact query shape it came from. */
  let loaded: { page: number; sig: string; firstId: unknown; lastId: unknown } | null = null;
  let lastSkip = $state(0);

  /** AND the keyset clause onto the user's filter (ExtJSON string); null when the filter cannot be re-parsed. */
  function mergeKeysetFilter(userFilter: string, patch: object): string | null {
    const trimmed = userFilter.trim();
    if (trimmed === "" || trimmed === "{}") return JSON.stringify(patch);
    try {
      return JSON.stringify({ $and: [JSON.parse(trimmed), patch] });
    } catch {
      return null;
    }
  }

  /** Load the current page (replaces docs). Adjacent moves under an `_id` sort seek by key; a short keyset page re-fetches with skip. */
  async function loadPage() {
    ctx.setLoading(true);
    allShown = false;
    ctx.setError(null);
    const gen = ctx.currentGeneration();
    const startedAt = Date.now();
    activity.begin(m.status_bar_loading());
    try {
      const filter = ctx.getAppliedFilter();
      const sortKeys = ctx.getSortKeys();
      const sort = buildSort(sortKeys);
      const projection = buildProjection(ctx.getHidden());
      const sig = JSON.stringify([filter, sort, pageSize]);
      const page = currentPage;
      const skipN = skipFor(page, pageSize);
      const plan = planPageFetch({
        sort: sortKeys,
        fromPage: loaded?.page ?? 0,
        toPage: page,
        pageSize,
        boundary: loaded && loaded.sig === sig ? loaded : null,
      });
      const run = (f: string, srt: string | null, skip: number) =>
        queryPage(sessionId, db, coll, skip, pageSize, f, srt, projection, settings.queryTimeoutMs);

      let batch: Doc[] | null = null;
      let usedFilter = filter;
      let usedSort = sort;
      let usedSkip = skipN;
      if (plan.kind === "keyset") {
        const merged = mergeKeysetFilter(filter, plan.filterPatch);
        if (merged !== null) {
          const dir = keysetSortDir(sortKeys) ?? 1;
          const kSort = plan.reverse ? JSON.stringify({ _id: -dir }) : sort;
          const got = await run(merged, kSort, 0);
          if (gen !== ctx.currentGeneration()) return;
          // `$gt`/`$lt` only match _id values of the same BSON type: a short page while more docs exist means we skipped some.
          const expected = Math.max(0, Math.min(pageSize, totalCount - skipN));
          if (got.length >= expected) {
            batch = plan.reverse ? [...got].reverse() : got;
            usedFilter = merged;
            usedSort = kSort;
            usedSkip = 0;
          }
        }
      }
      if (batch === null) {
        batch = await run(filter, sort, skipN);
        if (gen !== ctx.currentGeneration()) return;
      }
      lastQueryMs = Date.now() - startedAt;
      lastSkip = usedSkip;
      loaded = batch.length > 0
        ? { page, sig, firstId: batch[0]._id, lastId: batch[batch.length - 1]._id }
        : null;
      commandLog.push(
        findCmd({ coll, filter: usedFilter, projection, sort: usedSort, skip: usedSkip, limit: pageSize }),
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
    /** True when the page just loaded needed a skip so large that Mongo walks that many entries. */
    get deepPageSlow() { return lastSkip > DEEP_SKIP_HINT_THRESHOLD; },
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
