/** Infer schema (types, presence) from a document sample and merge it with display columns. */
import { describeValue, type BsonType } from "./extjson";
import type { Doc } from "./doc";

/** Reads a value by pre-split path segments (undefined on a scalar/missing key mid-path); a numeric segment indexes an array. */
export function getBySegments(doc: unknown, segments: readonly (string | number)[]): unknown {
  let cur: unknown = doc;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Read a value by dot-path; returns undefined when a scalar or missing key is hit mid-path. */
export function getByPath(doc: Doc, path: string): unknown {
  return getBySegments(doc, path.split("."));
}

export interface FieldSchema {
  path: string;
  type: BsonType;
  mixed: boolean;
  presence: number;
}

export interface CollectionSchema {
  sampleSize: number;
  fields: FieldSchema[];
}

/** Display column. Metadata (type/mixed/presence) is present only for schema-inferred columns;
 * row-derived columns (extra fields outside the sample) have these fields undefined. */
export interface ColumnField {
  path: string;
  type?: BsonType;
  mixed?: boolean;
  presence?: number;
}

/** True for a plain object with keys, none starting with `$` — recurse into children. */
function isContainer(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => !k.startsWith("$"));
}

/** Call cb(path, value) for every leaf dot-path in a document (depth-first). */
function walkLeaves(doc: Doc, cb: (path: string, value: unknown) => void): void {
  const recurse = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (isContainer(v)) recurse(v, path);
      else cb(path, v);
    }
  };
  recurse(doc, "");
}

/** Promote "_id" to the front if present. */
function idFirst(paths: string[]): string[] {
  return paths.includes("_id") ? ["_id", ...paths.filter((p) => p !== "_id")] : paths;
}

/** All leaf dot-paths found across docs, in discovery order (_id first). */
export function flattenPaths(docs: Doc[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const d of docs) {
    walkLeaves(d, (path) => {
      if (!seen.has(path)) {
        seen.add(path);
        order.push(path);
      }
    });
  }
  return idFirst(order);
}

/** Infer schema from a document sample: dominant type, mixed flag, and presence ratio per leaf dot-path. */
export function inferSchema(docs: Doc[]): CollectionSchema {
  const order: string[] = [];
  const tally = new Map<string, Map<BsonType, number>>();
  const present = new Map<string, number>();

  for (const d of docs) {
    walkLeaves(d, (path, value) => {
      if (!tally.has(path)) {
        tally.set(path, new Map());
        order.push(path);
      }
      const t = describeValue(value).type;
      const m = tally.get(path)!;
      m.set(t, (m.get(t) ?? 0) + 1);
      present.set(path, (present.get(path) ?? 0) + 1);
    });
  }

  const sampleSize = docs.length;
  const fields: FieldSchema[] = idFirst(order).map((path) => {
    const m = tally.get(path)!;
    let type: BsonType = "unknown";
    let max = -1;
    for (const [t, c] of m) {
      if (c > max) {
        max = c;
        type = t;
      }
    }
    return {
      path,
      type,
      mixed: m.size > 1,
      presence: sampleSize ? (present.get(path) ?? 0) / sampleSize : 0,
    };
  });

  return { sampleSize, fields };
}

/** Display columns = schema fields (with metadata) plus any extra paths found only in docs (no metadata). */
export function mergeColumns(schema: CollectionSchema | null, docs: Doc[]): ColumnField[] {
  const base: ColumnField[] = schema
    ? schema.fields.map((f) => ({ path: f.path, type: f.type, mixed: f.mixed, presence: f.presence }))
    : [];
  const known = new Set(base.map((c) => c.path));
  const extras = flattenPaths(docs).filter((p) => !known.has(p));
  return [...base, ...extras.map((path) => ({ path }))];
}

/** Collapses columns deeper than `maxDepth` into their maxDepth-segment prefix (type "object"); null = unlimited, dedupes preserving first-seen order. */
export function limitColumnsToDepth(cols: ColumnField[], maxDepth: number | null): ColumnField[] {
  if (maxDepth === null) return cols;
  const byPath = new Map<string, ColumnField>();
  for (const c of cols) {
    const segs = c.path.split(".");
    if (segs.length <= maxDepth) {
      if (!byPath.has(c.path)) byPath.set(c.path, c);
    } else {
      const prefix = segs.slice(0, maxDepth).join(".");
      if (!byPath.has(prefix)) byPath.set(prefix, { path: prefix, type: "object" });
    }
  }
  return [...byPath.values()];
}
