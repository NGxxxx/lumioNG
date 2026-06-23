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

/**
 * Build an {_id:{$in:[…]}} Canonical Extended JSON filter string from a list of
 * id ExtJSON strings. Caller guarantees `idJsons` is non-empty and every entry
 * is valid id Extended JSON (as produced by domain/docid `idJson`).
 */
export function idInFilter(idJsons: string[]): string {
  return `{"_id":{"$in":[${idJsons.join(",")}]}}`;
}

/**
 * Resolve a list of row indices into the doc array to their _id ExtJSON strings.
 * Returns `{ missing: true }` as soon as any referenced doc lacks an _id.
 */
export function resolveIds(docs: Doc[], rows: Iterable<number>): { ids: string[] } | { missing: true } {
  const ids: string[] = [];
  for (const row of rows) {
    const id = idJson(docs[row]);
    if (id === null) return { missing: true };
    ids.push(id);
  }
  return { ids };
}

/**
 * Effective rows for a right-click action: the full multi-selection when the
 * menu's row is part of it, otherwise the menu row alone. With no menu open,
 * falls back to the current selection.
 */
export function effectiveRows(menuRow: number | null, selected: Set<number>): number[] {
  if (menuRow === null) return [...selected];
  if (selected.has(menuRow)) return [...selected];
  return [menuRow];
}
