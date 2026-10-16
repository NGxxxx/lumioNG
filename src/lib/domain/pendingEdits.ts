import type { Doc } from "./doc";
import { idJson } from "./docid";
import { setByPath } from "./celledit";

/** A cell edit waiting for Commit: `before` is the value when it was first staged, `after` the latest one. */
export interface PendingEdit {
  /** Canonical ExtJSON of the document's `_id`. */
  idJson: string;
  path: string;
  before: unknown;
  after: unknown;
}

export const pendingKey = (id: string, path: string) => `${id}\u0000${path}`;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Adds or updates the edit for one cell. Re-editing keeps the first `before` and moves the cell to the
 *  end, so commit order follows the order of the last edits; returning to `before` un-stages it. */
export function stageEdit(list: readonly PendingEdit[], edit: PendingEdit): PendingEdit[] {
  const prev = list.find((p) => p.idJson === edit.idJson && p.path === edit.path);
  const rest = prev ? list.filter((p) => p !== prev) : [...list];
  const merged = { ...edit, before: prev ? prev.before : edit.before };
  return same(merged.before, merged.after) ? rest : [...rest, merged];
}

/** The documents with their staged values applied; unchanged documents (and the array, when none
 *  change) keep their identity. */
export function overlayPending(docs: Doc[], list: readonly PendingEdit[]): Doc[] {
  if (list.length === 0) return docs;
  const byId = new Map<string, PendingEdit[]>();
  for (const p of list) byId.set(p.idJson, [...(byId.get(p.idJson) ?? []), p]);
  let changed = false;
  const out = docs.map((d) => {
    const id = idJson(d);
    const edits = id === null ? undefined : byId.get(id);
    if (!edits) return d;
    changed = true;
    return edits.reduce((acc, p) => setByPath(acc, p.path, p.after), d);
  });
  return changed ? out : docs;
}

export function pendingKeys(list: readonly PendingEdit[]): Set<string> {
  return new Set(list.map((p) => pendingKey(p.idJson, p.path)));
}
