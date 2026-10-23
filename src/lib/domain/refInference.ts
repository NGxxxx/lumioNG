/**
 * Reference inference between collections: which ObjectId fields look like foreign keys to which
 * collection. Pure — name heuristics come from `refTarget`; verification against real data (does the
 * value exist as an `_id` there?) is done by the store, then scored with `scoreCandidate`.
 */
import type { CollectionSchema, FieldSchema } from "./schema";
import type { Doc } from "./doc";
import { getByPath } from "./schema";
import { isSelfId, normalizeRefPath, refIdText, resolveRef } from "./refTarget";

export type RefCandidate = {
  /** `from.path->to`: stable key of the edge. */
  id: string;
  from: string;
  path: string;
  to: string;
  /** The field is an array of ObjectIds: one-to-many. */
  many: boolean;
};

/** Minimum share of sampled values that must exist in the target collection. */
export const MIN_REF_SCORE = 0.8;
/** Values checked per candidate (one `{_id: {$in}}` query). */
export const REF_VALUES_PER_CANDIDATE = 20;

const PROBE = { $oid: "000000000000000000000000" };

function holdsObjectId(f: FieldSchema): boolean {
  if (f.type === "objectId" || f.type === "array") return true;
  return f.mixed && (f.types ?? []).some((t) => t === "objectId" || t === "array");
}

/**
 * Fields that are ObjectIds (not `_id`) or arrays — arrays are leaves in the inferred schema, so their
 * element type is confirmed later from real values — whose name resolves to a collection of the
 * database (`userId` → `users`).
 */
export function candidateRefs(schemas: Record<string, CollectionSchema>): RefCandidate[] {
  const names = Object.keys(schemas);
  const out: RefCandidate[] = [];
  for (const from of names) {
    for (const field of schemas[from].fields) {
      if (isSelfId(field.path) || !holdsObjectId(field)) continue;
      const res = resolveRef({ path: field.path, value: PROBE, db: "", coll: from }, names, null);
      const targets = res.kind === "one" ? [res.target.coll] : res.kind === "many" ? res.targets.map((t) => t.coll) : [];
      const many = field.type === "array" || (field.types ?? []).includes("array");
      for (const to of targets) out.push({ id: `${from}.${field.path}->${to}`, from, path: field.path, to, many });
    }
  }
  return out;
}

/** Share of sampled values found in the target; 0 when nothing was sampled. */
export function scoreCandidate(hits: number, sampled: number): number {
  if (sampled <= 0) return 0;
  return Math.min(1, Math.max(0, hits / sampled));
}

export function keepStrong<T extends { score: number }>(items: T[], min: number = MIN_REF_SCORE): T[] {
  return items.filter((i) => i.score >= min);
}

/**
 * Up to `limit` distinct ObjectId values (canonical ExtJSON text) found at `path` in the sampled
 * documents; array fields contribute their ObjectId elements. DBRefs count by their `$id`.
 */
export function collectRefValues(docs: Doc[], path: string, limit: number = REF_VALUES_PER_CANDIDATE): string[] {
  const seen = new Set<string>();
  const p = normalizeRefPath(path);
  for (const d of docs) {
    const v = getByPath(d, p);
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) {
      const t = refIdText(it);
      if (t !== null && t.startsWith('{"$oid"')) seen.add(t);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}
