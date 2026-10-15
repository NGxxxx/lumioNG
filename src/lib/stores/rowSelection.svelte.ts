import { resolveIds, effectiveRows as effectiveRowsOf, clickRowSelection, selectForMenu } from "../domain/selection";
import { type Doc } from "../domain/doc";

export type RowMenu = { x: number; y: number; row: number; key: string; source?: "grid" | "tree" };

/** Row-selection state for a paged grid: click/shift/ctrl selection, "select all"/"invert" over the
 *  currently visible (search-filtered) rows, the right-click context menu, and resolving the
 *  selection -- or the right-clicked row when nothing is selected -- to `_id` ExtJSON for bulk
 *  update/delete/export. */
export function createRowSelection(args: {
  getDocs: () => Doc[];
  getVisibleIndices: () => number[] | null;
}) {
  let selected = $state<Set<number>>(new Set());
  let anchor = $state<number | null>(null);
  let menu = $state<RowMenu | null>(null);
  const selectedCount = $derived(selected.size);

  function clickRow(row: number, mods: { ctrl: boolean; shift: boolean }) {
    ({ selected, anchor } = clickRowSelection({ selected, anchor }, row, mods, args.getVisibleIndices()));
  }

  /** Select the right-clicked row alone, unless it's already part of the current multi-selection. */
  function selectForMenuRow(row: number) {
    ({ selected, anchor } = selectForMenu({ selected, anchor }, row));
  }

  function selectAll() {
    const docs = args.getDocs();
    selected = new Set(args.getVisibleIndices() ?? docs.map((_, i) => i));
    anchor = docs.length > 0 ? 0 : null;
  }

  function invertSelection() {
    const universe = args.getVisibleIndices() ?? args.getDocs().map((_, i) => i);
    const next = new Set(universe.filter((i) => !selected.has(i)));
    selected = next;
    anchor = next.size > 0 ? [...next][0] : null;
  }

  /** Replace the selection wholesale (keyboard navigation computes it in domain/gridNav). */
  function setSelected(rows: Set<number>) {
    selected = new Set(rows);
    anchor = rows.size > 0 ? [...rows][0] : null;
  }

  function clearSelection() {
    selected = new Set();
    anchor = null;
  }

  /** Resolve selected rows to id ExtJSON; reports `missing` if any lacks _id. */
  function selectedIds(): { ids: string[] } | { missing: true } {
    return resolveIds(args.getDocs(), selected);
  }

  /** Effective selection for right-click: the multi-select if the menu row is in it, else the menu row alone. */
  function effectiveRows(): number[] {
    return effectiveRowsOf(menu ? menu.row : null, selected);
  }
  function effectiveSelectionCount(): number {
    return effectiveRows().length;
  }
  function effectiveIds(): { ids: string[] } | { missing: true } {
    return resolveIds(args.getDocs(), effectiveRows());
  }

  function openMenu(e: MouseEvent, row: number, key: string, source: "grid" | "tree" = "grid") {
    e.preventDefault();
    e.stopPropagation();
    selectForMenuRow(row);
    menu = { x: e.clientX, y: e.clientY, row, key, source };
  }

  function closeMenu() {
    menu = null;
  }

  return {
    get selected() {
      return selected;
    },
    get selectedCount() {
      return selectedCount;
    },
    get menu() {
      return menu;
    },
    clickRow,
    setSelected,
    selectForMenuRow,
    selectAll,
    invertSelection,
    clearSelection,
    selectedIds,
    effectiveRows,
    effectiveSelectionCount,
    effectiveIds,
    openMenu,
    closeMenu,
  };
}
