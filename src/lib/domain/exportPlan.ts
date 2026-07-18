/** Pure helpers for the Export Wizard: target selection, filenames, progress aggregation. */
import type { Doc } from "./doc";
import { getByPath } from "./schema";
import type { BsonType } from "./extjson";

/** Stable key for a (db, coll) pair. JSON-encodes the tuple so no separator char is
 *  needed — unambiguous even when names contain spaces, dots, or other punctuation. */
export function targetKey(db: string, coll: string): string {
  return JSON.stringify([db, coll]);
}

/** Checked (db, coll) pairs in tree order. `checked` holds `targetKey` values. */
export function buildTargets(
  databases: { name: string; collections: string[] }[],
  checked: Set<string>,
): { db: string; coll: string }[] {
  const out: { db: string; coll: string }[] = [];
  for (const d of databases) {
    for (const c of d.collections) {
      if (checked.has(targetKey(d.name, c))) out.push({ db: d.name, coll: c });
    }
  }
  return out;
}

/** Output file basename for one collection. */
export function exportFileName(db: string, coll: string, ext: string): string {
  return `${db}.${coll}.${ext}`;
}

/** Sum done/total across rows; percent rounded (0 when total is 0). */
export function aggregateProgress(
  rows: { done: number; total: number }[],
): { done: number; total: number; percent: number } {
  const done = rows.reduce((a, r) => a + r.done, 0);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

/** Exclusion projection ExtJSON for unchecked columns; drops `_id` when unchecked. null = no-op. */
export function buildExportProjection(allColumns: string[], selected: string[]): string | null {
  const sel = new Set(selected);
  const obj: Record<string, number> = {};
  for (const p of allColumns) if (p !== "_id" && !sel.has(p)) obj[p] = 0;
  if (!sel.has("_id")) obj._id = 0;
  return Object.keys(obj).length === 0 ? null : JSON.stringify(obj);
}

/** Rebuild each doc with only the selected dot-paths (missing paths skipped). */
export function pickColumns(docs: Doc[], paths: string[]): Doc[] {
  return docs.map((d) => {
    const out: Doc = {};
    for (const p of paths) {
      const v = getByPath(d, p);
      if (v === undefined) continue;
      const segs = p.split(".");
      let cur = out as Record<string, unknown>;
      for (let i = 0; i < segs.length - 1; i++) {
        const s = segs[i];
        const next = cur[s];
        if (typeof next !== "object" || next === null || Array.isArray(next)) cur[s] = {};
        cur = cur[s] as Record<string, unknown>;
      }
      cur[segs[segs.length - 1]] = v;
    }
    return out;
  });
}

/** Distinct fields among `selectedCols` that will be written as JSON text on export, rather than
 *  their original type — count differs by format because CSV and SQL disagree on what "one
 *  column" means for a nested value:
 *  - CSV (toCsv/flattenPaths) flattens every leaf into its own scalar column, so a nested object
 *    round-trips losslessly as separate leaf columns; only a leaf whose own value is an array (or,
 *    rarely, a genuinely empty object) is written as JSON text. Counts lossy LEAF columns.
 *  - SQL (toSql/topLevelColumns) never flattens — any top-level field that is an object is written
 *    whole as JSON text regardless of which leaf sub-paths are selected. A selected dotted path
 *    means its top-level parent is an object; an undotted selected leaf counts only when its own
 *    type is array or object. Counts distinct TOP-LEVEL field names. */
export function countLossyExportFields(
  selectedCols: { path: string; type?: BsonType }[],
  format: "csv" | "sql",
): number {
  if (format === "csv") {
    return selectedCols.filter((c) => c.type === "array" || c.type === "object").length;
  }
  const topLevel = new Set<string>();
  for (const c of selectedCols) {
    if (c.path.includes(".") || c.type === "array" || c.type === "object") {
      topLevel.add(c.path.split(".")[0]);
    }
  }
  return topLevel.size;
}

/** Input contract for the Export Wizard, defined here in `domain/` (not the component) so stores can reference it without a store→component dependency. */
export type ExportWizardInput =
  | { mode: "pick"; preChecked: { db: string; coll: string }[] }
  | {
      mode: "scopedCollection";
      db: string;
      coll: string;
      filter: string;
      sort: string | null;
      columns: { path: string; visible: boolean; type?: BsonType }[];
      summary: string;
    }
  | {
      mode: "scopedMemory";
      coll: string;
      docs: Doc[];
      columns: { path: string; visible: boolean; type?: BsonType }[];
      summary: string;
    };
