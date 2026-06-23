/** Tree-editor helpers: leaf type system, raw-text extraction, value rebuild, and field validation. */
import { describeValue, type BsonType } from "./extjson";
import { rebuildNumber } from "./bsonnum";
import type { RebuildResult } from "./celledit";

/** Leaf types that have a dedicated input cell in the tree (Tier 2). */
export type LeafInputType =
  | "string" | "bool" | "int" | "long" | "double" | "decimal" | "date" | "objectId";

/** Types available when adding a new field or element. */
export type AddableType = LeafInputType | "null" | "object" | "array";

export const ADDABLE_TYPES: AddableType[] = [
  "string", "int", "long", "double", "decimal", "bool", "date", "objectId", "null", "object", "array",
];

/** Must stay in sync with LeafInputType (8 leaf types with an input cell). */
const INPUT_TYPES = new Set<BsonType>([
  "string", "bool", "int", "long", "double", "decimal", "date", "objectId",
]);

/** BSON type of an ExtJSON value (delegates to describeValue). */
function nodeType(value: unknown): BsonType {
  return describeValue(value).type;
}

/** Whether the type has an editable input cell in the tree (binary/null/object/array/unknown: false). */
export function hasInput(type: BsonType): boolean {
  return INPUT_TYPES.has(type);
}

/** Raw text to load into the input when rendering a leaf cell. */
export function editTextOf(value: unknown): string {
  const t = nodeType(value);
  if (t === "string") return value as string;
  if (t === "bool") return value ? "true" : "false";
  const o = value as Record<string, unknown>;
  switch (t) {
    case "int": return String(o.$numberInt);
    case "long": return String(o.$numberLong);
    case "double": return typeof value === "number" ? String(value) : String(o.$numberDouble);
    case "decimal": return String(o.$numberDecimal);
    case "objectId": return String(o.$oid);
    case "date": {
      const d = o.$date;
      if (typeof d === "string") return d;
      if (d && typeof d === "object" && "$numberLong" in (d as object)) {
        return new Date(Number((d as Record<string, unknown>).$numberLong)).toISOString();
      }
      return "";
    }
  }
  return "";
}

/**
 * Rebuild an ExtJSON value of the given `type` from user-entered text.
 * Intentionally overlaps with celledit.rebuildValue: celledit locks on the
 * runtime type of the original value (inline-edit); bsontree locks on the
 * named type and is a superset that adds date/objectId.
 */
export function rebuildLeaf(type: LeafInputType, text: string): RebuildResult {
  const t = text.trim();
  switch (type) {
    case "string":
      return { ok: true, value: text };
    case "bool":
      if (t === "true") return { ok: true, value: true };
      if (t === "false") return { ok: true, value: false };
      return { ok: false, error: "err_bool_invalid" };
    case "int":
    case "long":
    case "double":
    case "decimal":
      return rebuildNumber(type, t);
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return { ok: false, error: "err_date_invalid" };
      const ms = Date.parse(t);
      if (Number.isNaN(ms)) return { ok: false, error: "err_date_invalid" };
      return { ok: true, value: { $date: { $numberLong: String(ms) } } };
    }
    case "objectId":
      if (!/^[0-9a-fA-F]{24}$/.test(t)) return { ok: false, error: "err_objectid_invalid" };
      return { ok: true, value: { $oid: t } };
  }
}

/**
 * Validate a new field name before adding it to an object. Returns a message
 * key (e.g. `err_field_name_empty`, `err_field_name_duplicate`) or null when
 * valid. The name is trimmed before checking.
 */
export function validateNewFieldName(name: string, existingKeys: string[]): string | null {
  const n = name.trim();
  if (n === "") return "err_field_name_empty";
  if (existingKeys.includes(n)) return "err_field_name_duplicate";
  return null;
}

/** Typed empty value for a new field/element (deterministic — no Date.now). */
export function emptyValue(type: AddableType): unknown {
  switch (type) {
    case "string": return "";
    case "int": return { $numberInt: "0" };
    case "long": return { $numberLong: "0" };
    case "double": return { $numberDouble: "0" };
    case "decimal": return { $numberDecimal: "0" };
    case "bool": return false;
    case "date": return { $date: { $numberLong: "0" } };
    case "objectId": return { $oid: "000000000000000000000000" };
    case "null": return null;
    case "object": return {};
    case "array": return [];
  }
}
