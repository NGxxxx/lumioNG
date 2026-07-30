/** Row-selection helpers: index range, _id-based filter construction, and id resolution. */

import type { Doc } from "./doc";
import { idJson } from "./docid";

/** Inclusive index range between a and b, ascending; order-independent. */
export function rangeBetween(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Build an {_id:{$in:[…]}} Canonical Extended JSON filter string from a list of id ExtJSON strings; caller guarantees `idJsons` is non-empty and valid. */
export function idInFilter(idJsons: string[]): string {
  return `{"_id":{"$in":[${idJsons.join(",")}]}}`;
}

/** Resolve a list of row indices into the doc array to their _id ExtJSON strings; returns `{ missing: true }` as soon as any referenced doc lacks an _id. */
export function resolveIds(docs: Doc[], rows: Iterable<number>): { ids: string[] } | { missing: true } {
  const ids: string[] = [];
  for (const row of rows) {
    const id = idJson(docs[row]);
    if (id === null) return { missing: true };
    ids.push(id);
  }
  return { ids };
}

/** Effective rows for a right-click action: the full multi-selection when the menu's row is part of it, otherwise the menu row alone; with no menu open, falls back to the current selection. */
export function effectiveRows(menuRow: number | null, selected: Set<number>): number[] {
  if (menuRow === null) return [...selected];
  if (selected.has(menuRow)) return [...selected];
  return [menuRow];
}

export interface RowSelection {
  selected: Set<number>;
  anchor: number | null;
}

/** Next selection for a row click: shift range-selects from anchor (clamped to `visible`), ctrl toggles, plain click selects just that row. */
export function clickRowSelection(
  current: RowSelection,
  row: number,
  mods: { ctrl: boolean; shift: boolean },
  visible: number[] | null,
): RowSelection {
  if (mods.shift && current.anchor !== null) {
    const range = rangeBetween(current.anchor, row);
    if (!visible) return { selected: new Set(range), anchor: current.anchor };
    const visibleSet = new Set(visible);
    return { selected: new Set(range.filter((i) => visibleSet.has(i))), anchor: current.anchor };
  }
  if (mods.ctrl) {
    const next = new Set(current.selected);
    if (next.has(row)) next.delete(row);
    else next.add(row);
    return { selected: next, anchor: row };
  }
  return { selected: new Set([row]), anchor: row };
}

/** Right-click outside the selection replaces it with just that row; inside it, leaves it untouched. */
export function selectForMenu(current: RowSelection, row: number): RowSelection {
  if (current.selected.has(row)) return current;
  return { selected: new Set([row]), anchor: row };
}
