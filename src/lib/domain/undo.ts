import type { Doc } from "./doc";
import { getByPath } from "./schema";

export type UndoEntry = { id: number; sessionId: string; db: string; coll: string; at: number } & (
  | { kind: "replace"; before: Doc; after: Doc }
  | { kind: "cell"; idJson: string; path: string; before: unknown | undefined; after: unknown }
  | { kind: "insert"; doc: Doc }
  | { kind: "delete"; docs: Doc[] }
);

const NUM_KEYS = ["$numberDouble", "$numberInt", "$numberLong", "$numberDecimal"];

/** Numeric value of a plain number or a single-key ExtJSON number wrapper; null otherwise. */
function numOf(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 1 || !NUM_KEYS.includes(keys[0])) return null;
  const n = Number((v as Record<string, unknown>)[keys[0]]);
  return Number.isNaN(n) ? null : n;
}

/** Structural equality for Extended JSON values; object key order is irrelevant, and numbers compare
 *  by value across representations (the server re-reads `{"$numberDouble":"2"}` as `"2.0"`, a bare
 *  `5` as `{"$numberInt":"5"}`). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = numOf(a);
  if (na !== null) return na === numOf(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** True when the document no longer looks the way the edit left it, so undoing would overwrite someone else's change. */
export function hasConflict(entry: UndoEntry, current: Doc | null): boolean {
  switch (entry.kind) {
    case "replace": return current === null || !same(current, entry.after);
    case "cell": return current === null || !same(getByPath(current, entry.path), entry.after);
    case "insert": return current === null || !same(current, entry.doc);
    case "delete": return false;
  }
}

/** Update document (Extended JSON text) that restores a cell edit. */
export function inverseUpdate(entry: UndoEntry & { kind: "cell" }): string {
  return entry.before === undefined
    ? JSON.stringify({ $unset: { [entry.path]: "" } })
    : JSON.stringify({ $set: { [entry.path]: entry.before } });
}

/** Message key + document count for the undo toast / list. */
export function describeUndo(entry: UndoEntry): { key: string; count: number } {
  return { key: `undo_${entry.kind}`, count: entry.kind === "delete" ? entry.docs.length : 1 };
}
