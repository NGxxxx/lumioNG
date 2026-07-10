import { emptyValue, type AddableType } from "./bsontree";
import type { BsonType } from "./extjson";
import type { Doc } from "./doc";

/** Map an inferred BSON type to the closest skeleton placeholder type; unsupported → null. */
function skeletonType(t?: BsonType): AddableType {
  switch (t) {
    case "string":
    case "int":
    case "long":
    case "double":
    case "decimal":
    case "bool":
    case "date":
    case "objectId":
    case "object":
    case "array":
      return t;
    default:
      return "null"; // null / binary / unknown / missing
  }
}

/** Assign `value` at a dot-path, creating intermediate objects as needed. */
function setByPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = cur[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

/** Build an empty document skeleton from a collection's inferred fields so "New document" pre-fills every known field with a typed empty value; `_id` is excluded so the server generates a fresh one. */
export function buildSkeleton(fields: { path: string; type?: BsonType }[]): Doc {
  const doc: Doc = {};
  for (const f of fields) {
    if (f.path === "_id") continue;
    setByPath(doc, f.path, emptyValue(skeletonType(f.type)));
  }
  return doc;
}

/** Duplicate a document for re-insert: deep clone, drop `_id` (server assigns a new one). */
export function duplicateForInsert(doc: Doc): Doc {
  const clone = JSON.parse(JSON.stringify(doc)) as Doc;
  delete clone._id;
  return clone;
}
