import { describeValue, type BsonType } from "./extjson";
import type { Doc } from "./columns";

/** Đọc giá trị theo dot-path; gặp scalar/array/thiếu giữa chừng → undefined. */
export function getByPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
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

/** Cột hiển thị. Metadata (type/mixed/presence) chỉ có khi cột suy từ schema;
 * cột row-derived (field thừa ngoài sample) thì các field này là undefined. */
export interface ColumnField {
  path: string;
  type?: BsonType;
  mixed?: boolean;
  presence?: number;
}

/** Object "container" (recurse vào con) iff plain object, có key, và không key nào bắt đầu `$`. */
function isContainer(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v as Record<string, unknown>);
  return keys.length > 0 && keys.every((k) => !k.startsWith("$"));
}

/** Gọi cb(path, value) cho mọi leaf dot-path trong doc (depth-first). */
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

/** Đưa "_id" lên đầu nếu có. */
function idFirst(paths: string[]): string[] {
  return paths.includes("_id") ? ["_id", ...paths.filter((p) => p !== "_id")] : paths;
}

/** Tập leaf dot-path xuất hiện trong docs, theo thứ tự phát hiện (_id đầu). */
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

/** Suy schema từ mẫu doc: kiểu trội + cờ mixed + % hiện diện cho mỗi leaf dot-path. */
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

/** Cột hiển thị = field schema (có metadata) + path thừa trong docs (không metadata). */
export function mergeColumns(schema: CollectionSchema | null, docs: Doc[]): ColumnField[] {
  const base: ColumnField[] = schema
    ? schema.fields.map((f) => ({ path: f.path, type: f.type, mixed: f.mixed, presence: f.presence }))
    : [];
  const known = new Set(base.map((c) => c.path));
  const extras = flattenPaths(docs).filter((p) => !known.has(p));
  return [...base, ...extras.map((path) => ({ path }))];
}
