import type { ConsoleEntry, Provenance } from "../api/script";
import type { DisplayMode } from "../domain/scriptOutcome";
import { limitColumnsToDepth, type ColumnField } from "../domain/schema";
import { pageCount, clampPage } from "../domain/paging";
import type { Doc } from "../domain/doc";
import { settings } from "./settings.svelte";

/** "paged" mode (pure find()/aggregate() cursor): every page is fetched directly from Rust, bypassing QuickJS. */
export type PagedRecipe = {
  cursorKind: "find" | "agg";
  db: string; coll: string;
  query: string;
  sort: string | null;
  projection: string | null;
  baseSkip: number;
  fixedLimit: number | null;
};

/** The result state of one Query tab, shared by the run, explain and grid helpers of `createQueryScript`.
 *  Plain get/set pairs over `$state`/`$state.raw`: arrays are always reassigned wholesale (CLAUDE.md). */
export function createScriptResult(opts: { clearEdit: () => void }) {
  // "static" mode (unchanged old behavior): the FULL result already materialized through QuickJS; `docs` is a client-side slice of this.
  let fullDocs = $state.raw<Doc[]>([]);
  // Non-null `recipe` means "paged" mode.
  let recipe = $state<PagedRecipe | null>(null);
  // `docs` always means "current page," in EITHER mode — reassigned wholesale by every fetch/page-change/edit ($state.raw, per CLAUDE.md).
  let docs = $state.raw<Doc[]>([]);
  let consoleEntries = $state.raw<ConsoleEntry[]>([]);

  let rawColumnFields = $state<ColumnField[]>([]);
  const columnFields = $derived(limitColumnsToDepth(rawColumnFields, settings.gridMaxDepth));
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});

  let displayModeVal = $state<DisplayMode>("none");
  let valueJson = $state<string | null>(null);
  let ackJson = $state<string | null>(null);
  let capped = $state(false);
  let error = $state<string | null>(null);
  let ioError = $state<string | null>(null);
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
  // Reactive mirror of `generation` for the grid (cursor reset); plain `generation` stays the race guard.
  let loadCount = $state(0);

  /** Bump on every run/navigation/reload: in-flight fetches captured the old value and bail out, and
   *  any open cell edit is dropped — `editing.row` indexes the OLD page's `docs`, so leaving it open
   *  would silently rebind the edit box (and the eventual $set) to a different document. */
  function bumpGeneration(): number {
    opts.clearEdit();
    loadCount++;
    return ++generation;
  }

  const pgCount = $derived(
    recipe && recipe.fixedLimit !== null ? 1 : (showingAll ? 1 : pageCount(totalCount, pageSize)),
  );
  const page = $derived(showingAll ? 1 : clampPage(pageReq, pgCount));

  /** True when edit/delete actions are permitted (pure single-collection cursor result). */
  function isEditable(): boolean {
    return displayModeVal === "grid-editable" && provenance !== null;
  }

  return {
    get fullDocs() { return fullDocs; }, set fullDocs(v: Doc[]) { fullDocs = v; },
    get recipe() { return recipe; }, set recipe(v: PagedRecipe | null) { recipe = v; },
    get docs() { return docs; }, set docs(v: Doc[]) { docs = v; },
    get consoleEntries() { return consoleEntries; }, set consoleEntries(v: ConsoleEntry[]) { consoleEntries = v; },
    get rawColumnFields() { return rawColumnFields; }, set rawColumnFields(v: ColumnField[]) { rawColumnFields = v; },
    get columnFields() { return columnFields; },
    get colWidths() { return colWidths; }, set colWidths(v: Record<string, number>) { colWidths = v; },
    get defaultColWidths() { return defaultColWidths; }, set defaultColWidths(v: Record<string, number>) { defaultColWidths = v; },
    get displayModeVal() { return displayModeVal; }, set displayModeVal(v: DisplayMode) { displayModeVal = v; },
    get valueJson() { return valueJson; }, set valueJson(v: string | null) { valueJson = v; },
    get ackJson() { return ackJson; }, set ackJson(v: string | null) { ackJson = v; },
    get capped() { return capped; }, set capped(v: boolean) { capped = v; },
    get error() { return error; }, set error(v: string | null) { error = v; },
    get ioError() { return ioError; }, set ioError(v: string | null) { ioError = v; },
    get running() { return running; }, set running(v: boolean) { running = v; },
    get loading() { return loading; }, set loading(v: boolean) { loading = v; },
    get provenance() { return provenance; }, set provenance(v: Provenance | null) { provenance = v; },
    get lastElapsedMs() { return lastElapsedMs; }, set lastElapsedMs(v: number | null) { lastElapsedMs = v; },
    get pageSize() { return pageSize; }, set pageSize(v: number) { pageSize = v; },
    get pageReq() { return pageReq; }, set pageReq(v: number) { pageReq = v; },
    get showingAll() { return showingAll; }, set showingAll(v: boolean) { showingAll = v; },
    get totalCount() { return totalCount; }, set totalCount(v: number) { totalCount = v; },
    get generation() { return generation; },
    get loadCount() { return loadCount; },
    get pgCount() { return pgCount; },
    get page() { return page; },
    bumpGeneration,
    isEditable,
  };
}

export type ScriptResult = ReturnType<typeof createScriptResult>;
