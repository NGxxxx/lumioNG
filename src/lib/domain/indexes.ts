/** Parse, build, validate, and display MongoDB index definitions. */
import { numFromExt } from "./extjson";

export type IndexKeyValue = number | string;

export interface IndexInfo {
  name: string;
  entries: { field: string; value: IndexKeyValue }[]; // preserves field order
  unique: boolean;
  sparse: boolean;
  ttl: number | null; // expireAfterSeconds when present
  isId: boolean; // true when name === "_id_"
  hidden: boolean; // `hidden: true` in the index spec
  partial: boolean; // has a partialFilterExpression
  collation: string | null; // JSON text of the collation spec, or null
}

function normalizeKeyValue(v: unknown): IndexKeyValue {
  const n = numFromExt(v);
  return n !== null ? n : String(v); // "text" / "2dsphere" / "hashed" ...
}

/** Parse a list of index documents (Canonical ExtJSON) → IndexInfo[]. */
export function parseIndexList(jsonStrings: string[]): IndexInfo[] {
  return jsonStrings.map((s) => {
    const doc = JSON.parse(s) as Record<string, unknown>;
    const name = String(doc.name ?? "");
    const key = (doc.key ?? {}) as Record<string, unknown>;
    const entries = Object.entries(key).map(([field, value]) => ({
      field,
      value: normalizeKeyValue(value),
    }));
    return {
      name,
      entries,
      unique: doc.unique === true,
      sparse: doc.sparse === true,
      ttl: numFromExt(doc.expireAfterSeconds),
      isId: name === "_id_",
      hidden: doc.hidden === true,
      partial: doc.partialFilterExpression != null,
      collation: doc.collation != null ? JSON.stringify(doc.collation) : null,
    };
  });
}

/** Build an ExtJSON keys string preserving field order (not relying on JS object key order). */
export function buildIndexKeys(fields: { field: string; dir: 1 | -1 }[]): string {
  const parts = fields.map((f) => `${JSON.stringify(f.field.trim())}:${f.dir}`);
  return `{${parts.join(",")}}`;
}

/** Returns a message key or null. Requires ≥1 non-empty field; no duplicate fields. */
export function validateIndexFields(fields: { field: string; dir: 1 | -1 }[]): string | null {
  const names = fields.map((f) => f.field.trim()).filter((n) => n.length > 0);
  if (names.length === 0) return "err_index_no_field";
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) return "err_index_field_duplicate";
    seen.add(n);
  }
  return null;
}

/** Format entries as "{ email: 1, age: -1 }" for display. */
export function describeKeys(entries: IndexInfo["entries"]): string {
  return `{ ${entries.map((e) => `${e.field}: ${e.value}`).join(", ")} }`;
}
