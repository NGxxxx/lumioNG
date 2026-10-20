import * as m from "#lib/paraglide/messages.js";
import type { Doc } from "../domain/doc";
import type { ColumnField } from "../domain/schema";
import type { FilterOp } from "../domain/filter";
import type { ViewPreset } from "../domain/viewPresets";
import type { MenuItem } from "../domain/gridView";
import {
  cycleSort,
  addSortKey,
  toggleSortDir,
  removeSortKey,
  moveSortKey,
  type SortKey,
} from "../domain/grid";
import { computeColumnWidths, clampWidth } from "../domain/colwidth";
import { loadLayout, saveLayout, clearLayout } from "./gridLayout";
import { createDebouncer } from "../domain/timing";

/** What the layout block needs from the owning collection view (all read lazily). */
export interface CollectionLayoutCtx {
  layoutKey: string;
  getDocs: () => Doc[];
  getColumnFields: () => ColumnField[];
  bumpGeneration: () => number;
  loadFirstPage: () => Promise<void>;
  reloadDocs: () => Promise<void>;
  filterBy: (path: string, op: FilterOp, value?: unknown) => Promise<void>;
  copy: (text: string) => Promise<void>;
}

/** Sort, column visibility/pinning/widths and Grid/Tree mode for one collection view, plus the
 *  remembered-layout persistence (spec §2.4). The saved layout is restored at construction, before the first load. */
export function createCollectionLayout(ctx: CollectionLayoutCtx) {
  const layoutKey = ctx.layoutKey;
  let sortKeys = $state<SortKey[]>([]);
  // Grid/Tree toggle, kept here (not in ResultTable's local state) so it survives the `#key` remount that
  // happens when switching context tabs away from and back to Data.
  let view = $state<"grid" | "tree">("grid");
  let hidden = $state<Set<string>>(new Set());
  // Columns kept visible on horizontal scroll (rendered first, sticky); per view, like widths.
  let pinned = $state<Set<string>>(new Set());
  let hiddenDraft = $state<Set<string>>(new Set());
  let colWidths = $state<Record<string, number>>({});
  let defaultColWidths = $state<Record<string, number>>({});
  let colWidthSig = "";

  // ── Remembered layout (spec §2.4): restored before the first load so the saved sort applies; the
  // filter is deliberately not part of it. ──
  const savedLayout = loadLayout(layoutKey);
  let savedWidths: Record<string, number> = savedLayout?.widths ?? {};
  if (savedLayout) {
    hidden = new Set(savedLayout.hidden);
    hiddenDraft = new Set(savedLayout.hidden);
    pinned = new Set(savedLayout.pinned);
    sortKeys = savedLayout.sort;
    view = savedLayout.mode;
  }
  function writeLayout() {
    const widths: Record<string, number> = { ...savedWidths };
    for (const [k, w] of Object.entries(colWidths)) if (w !== defaultColWidths[k]) widths[k] = w; else delete widths[k];
    savedWidths = widths;
    saveLayout(layoutKey, { hidden: [...hidden], pinned: [...pinned], widths, sort: sortKeys, mode: view });
  }
  // Column drags fire continuously: widths are written once the drag settles; everything else at once.
  const widthSaver = createDebouncer(300);
  function saveLayoutSoon() {
    widthSaver.cancel();
    writeLayout();
  }

  /** Compute default widths once per column-set; recompute only when the paths change. */
  function ensureColWidths() {
    const columnFields = ctx.getColumnFields();
    const sig = columnFields.map((c) => c.path).join("|");
    if (sig === colWidthSig) return;
    colWidthSig = sig;
    defaultColWidths = computeColumnWidths(columnFields, ctx.getDocs());
    const restored: Record<string, number> = {};
    for (const c of columnFields) if (savedWidths[c.path] !== undefined) restored[c.path] = savedWidths[c.path];
    colWidths = { ...defaultColWidths, ...restored };
  }

  function setColWidth(path: string, px: number) {
    colWidths = { ...colWidths, [path]: clampWidth(px) };
    widthSaver.schedule(writeLayout);
  }

  function resetColWidth(path: string) {
    if (defaultColWidths[path] === undefined) return;
    colWidths = { ...colWidths, [path]: defaultColWidths[path] };
    saveLayoutSoon();
  }

  /** Forgets the remembered layout and goes back to the defaults. */
  async function resetLayout() {
    widthSaver.cancel();
    clearLayout(layoutKey);
    savedWidths = {};
    hidden = new Set();
    hiddenDraft = new Set();
    pinned = new Set();
    view = "grid";
    colWidths = { ...defaultColWidths };
    sortKeys = [];
    clearLayout(layoutKey);
    ctx.bumpGeneration();
    await ctx.loadFirstPage();
  }

  /** Sync the draft to the currently applied state (call when opening the column chooser). */
  function resetProjectionDraft() {
    hiddenDraft = new Set(hidden);
  }

  function toggleHiddenDraft(path: string) {
    const next = new Set(hiddenDraft);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    hiddenDraft = next;
  }

  /** Commit draft → live projection and reload. */
  async function applyProjection() {
    hidden = new Set(hiddenDraft);
    saveLayoutSoon();
    await ctx.reloadDocs();
  }

  /** Apply a new sortKeys set: reset to page 1 and reload (shared by header-click and dropdown). */
  async function applySortChange(next: SortKey[]) {
    sortKeys = next;
    saveLayoutSoon();
    ctx.bumpGeneration();
    await ctx.loadFirstPage();
  }

  const toggleSort = (path: string, shift: boolean) =>
    applySortChange(cycleSort(sortKeys, path, shift));
  const addSort = (path: string) => applySortChange(addSortKey(sortKeys, path));
  const toggleSortDirAt = (path: string) => applySortChange(toggleSortDir(sortKeys, path));
  const removeSort = (path: string) => applySortChange(removeSortKey(sortKeys, path));
  const moveSort = (path: string, delta: number) =>
    applySortChange(moveSortKey(sortKeys, path, delta));
  const clearSort = () => applySortChange([]);

  function togglePin(path: string) {
    const next = new Set(pinned);
    if (!next.delete(path)) next.add(path);
    pinned = next;
    saveLayoutSoon();
  }

  function headerMenuItems(path: string): MenuItem[] {
    return [
      { label: m.col_menu_sort_asc(), action: "sortAsc" },
      { label: m.col_menu_sort_desc(), action: "sortDesc" },
      { label: m.col_menu_clear_sort(), action: "clearSort", disabled: !sortKeys.some((k) => k.path === path) },
      { label: m.col_menu_hide(), action: "hide", disabled: path === "_id" },
      { label: pinned.has(path) ? m.col_menu_unpin() : m.col_menu_pin(), action: "pin" },
      { label: m.col_menu_autofit(), action: "autofit" },
      { label: m.col_menu_copy_path(), action: "copyPath" },
      { label: m.col_menu_exists(), action: "exists" },
      { label: m.col_menu_not_exists(), action: "notExists" },
    ];
  }

  async function onHeaderMenuSelect(path: string, action: string) {
    switch (action) {
      case "sortAsc": return applySortChange([{ path, dir: 1 }]);
      case "sortDesc": return applySortChange([{ path, dir: -1 }]);
      case "clearSort": return applySortChange(removeSortKey(sortKeys, path));
      case "hide":
        if (path === "_id") return;
        hidden = new Set([...hidden, path]);
        hiddenDraft = new Set(hidden);
        saveLayoutSoon();
        return ctx.reloadDocs();
      case "pin": return togglePin(path);
      case "autofit": return resetColWidth(path); // default widths are content-fitted (domain/colwidth)
      case "copyPath": return ctx.copy(path);
      case "exists": return ctx.filterBy(path, "exists");
      case "notExists": return ctx.filterBy(path, "notExists");
    }
  }

  /** Show all fields (clear the hidden draft). */
  function showAllFieldsDraft() {
    hiddenDraft = new Set();
  }

  /** Hide all fields except _id (buildProjection never excludes _id). */
  function hideAllFieldsDraft() {
    hiddenDraft = new Set(ctx.getColumnFields().map((c) => c.path).filter((p) => p !== "_id"));
  }

  /** Adopts a view preset's layout (filter and reload are the caller's job). */
  function applyPresetLayout(p: ViewPreset) {
    hidden = new Set(p.hidden);
    hiddenDraft = new Set(p.hidden);
    pinned = new Set(p.pinned);
    sortKeys = p.sort;
    view = p.mode;
    writeLayout();
  }

  return {
    get sortKeys() { return sortKeys; },
    get view() { return view; },
    set view(v: "grid" | "tree") {
      view = v;
      saveLayoutSoon();
    },
    get hidden() { return hidden; },
    get hiddenDraft() { return hiddenDraft; },
    get pinned() { return pinned; },
    get colWidths() { return colWidths; },
    ensureColWidths,
    setColWidth,
    resetColWidth,
    resetLayout,
    resetProjectionDraft,
    toggleHiddenDraft,
    applyProjection,
    showAllFieldsDraft,
    hideAllFieldsDraft,
    toggleSort,
    addSort,
    toggleSortDirAt,
    removeSort,
    moveSort,
    clearSort,
    togglePin,
    headerMenuItems,
    onHeaderMenuSelect,
    applyPresetLayout,
  };
}
