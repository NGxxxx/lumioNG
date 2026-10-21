// src/lib/domain/compare.ts — pure helpers for comparing / syncing two collections (CompareTab).
import type { Doc } from "./doc";
import { diffDocs, type DocChange } from "./docDiff";

/** A collection on a given session (the two sides may be on different clusters). */
export type NsRef = { sessionId: string; db: string; coll: string };
/** `srcToDst` writes into the destination, `dstToSrc` writes into the source. */
export type Direction = "srcToDst" | "dstToSrc";
export type DiffKind = "onlySrc" | "onlyDst" | "different" | "same";

export type DiffSummary = { onlySrc: number; onlyDst: number; different: number; same: number; truncated: boolean };

export type SyncPlan = {
  src: NsRef;
  dst: NsRef;
  key: string;
  filter: string | null;
  ignoreFields: string[];
  insertMissing: boolean;
  replaceDifferent: boolean;
  deleteExtra: boolean;
  direction: Direction;
};

export type SyncCounts = { insert: number; replace: number; delete: number };
export type SyncReport = {
  dryRun: boolean;
  planned: SyncCounts;
  applied: SyncCounts;
  failed: number;
  errors: string[];
  summary: DiffSummary;
  cancelled: boolean;
  /** Planned but neither applied nor failed: the target changed meanwhile. */
  skipped: number;
  /** `_id` pairs of different BSON types: cannot be replaced in place, left alone. */
  typeConflicts: number;
};

/** "a, b.c\n d" → ["a", "b.c", "d"]. */
export function parseFieldList(text: string): string[] {
  return text.split(/[,\n]/).map((s) => s.trim()).filter((s) => s !== "");
}

/** Which side is read from and which is written to. */
export function syncEnds(plan: SyncPlan): { from: NsRef; to: NsRef } {
  return plan.direction === "srcToDst" ? { from: plan.src, to: plan.dst } : { from: plan.dst, to: plan.src };
}

/** Stable identity of a plan: a dry run only counts for the plan it was run with. */
export function planKey(plan: SyncPlan): string {
  const ignore = [...new Set(plan.ignoreFields.map((f) => f.trim()).filter((f) => f !== ""))].sort();
  return JSON.stringify([
    plan.src.sessionId, plan.src.db, plan.src.coll, plan.dst.sessionId, plan.dst.db, plan.dst.coll,
    plan.key.trim() || "_id", (plan.filter ?? "").trim(), ignore,
    plan.insertMissing, plan.replaceDifferent, plan.deleteExtra, plan.direction,
  ]);
}

export function sameNamespace(a: NsRef, b: NsRef): boolean {
  return a.sessionId === b.sessionId && a.db === b.db && a.coll === b.coll;
}

export function plannedTotal(r: SyncReport): number {
  return r.planned.insert + r.planned.replace + r.planned.delete;
}

/** Field changes the sync would make to the written side's document (empty for one-sided rows). */
export function rowChanges(row: { src: Doc | null; dst: Doc | null }, direction: Direction = "srcToDst"): DocChange[] {
  if (!row.src || !row.dst) return [];
  return direction === "srcToDst" ? diffDocs(row.dst, row.src) : diffDocs(row.src, row.dst);
}

/** Short text for a key value in Canonical Extended JSON. */
export function formatKey(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1) {
      const k = keys[0];
      if (k === "$oid" || k === "$numberInt" || k === "$numberLong" || k === "$numberDouble" || k === "$numberDecimal") return String(o[k]);
    }
  }
  return JSON.stringify(v);
}
