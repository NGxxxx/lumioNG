import type { Doc } from "./doc";
import { containerKind } from "./extjson";

export type DocChange = { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown };

/** Containers the diff descends into; ExtJSON wrappers ({$oid}, {$numberInt}…) are leaves compared whole. */
function isContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  return containerKind(v) !== null;
}

function equalLeaf(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
  }
  return v;
}

function walk(before: unknown, after: unknown, path: string, out: DocChange[]): void {
  const bk = containerKind(before);
  const ak = containerKind(after);
  if (bk !== null && bk === ak) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const join = (k: string) => (path ? `${path}.${k}` : k);
    // Removed/changed keys in `before` order, then keys new in `after`.
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ path: join(k), kind: "removed", before: b[k] });
      else walk(b[k], a[k], join(k), out);
    }
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.push({ path: join(k), kind: "added", after: a[k] });
    }
    return;
  }
  if (!isContainer(before) && !isContainer(after) ? equalLeaf(before, after) : false) return;
  out.push({ path, kind: "changed", before, after });
}

/** Structural diff of two Canonical Extended JSON docs: arrays by index, nested paths dotted; key order is irrelevant, ExtJSON wrappers are leaves (so Int 5 ≠ Long 5). */
export function diffDocs(before: Doc, after: Doc): DocChange[] {
  const out: DocChange[] = [];
  walk(before, after, "", out);
  return out;
}

/** One-line rendering of a change for the save-confirmation list. */
export function formatChange(c: DocChange): string {
  if (c.kind === "added") return `+ ${c.path}: ${JSON.stringify(c.after)}`;
  if (c.kind === "removed") return `− ${c.path}`;
  return `${c.path}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`;
}
