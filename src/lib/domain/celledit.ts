/** Inline-cell editing: editability check, raw-text extraction, and typed value rebuild. */
import { rebuildNumber, type NumericKind } from "./bsonnum";
import { editTextOf } from "./bsontree";
import type { Doc } from "./doc";

export type RebuildResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Raw text to seed the input when starting an edit (defined in bsontree). */
export { editTextOf };

const NUMERIC_KEYS = ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"] as const;

const KEY_TO_KIND: Record<(typeof NUMERIC_KEYS)[number], NumericKind> = {
  $numberInt: "int",
  $numberLong: "long",
  $numberDouble: "double",
  $numberDecimal: "decimal",
};

function numericKey(value: unknown): (typeof NUMERIC_KEYS)[number] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  for (const k of NUMERIC_KEYS) if (k in o) return k;
  return null;
}

/** Whether a cell can be edited inline; _id and all non-scalar types cannot. */
export function isInlineEditable(key: string, value: unknown): boolean {
  if (key === "_id") return false;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  return numericKey(value) !== null;
}

/** Rebuild a value with the same BSON type as `original` from user-entered text. */
export function rebuildValue(original: unknown, text: string): RebuildResult {
  if (typeof original === "string") return { ok: true, value: text };

  if (typeof original === "boolean") {
    if (text === "true") return { ok: true, value: true };
    if (text === "false") return { ok: true, value: false };
    return { ok: false, error: "err_bool_invalid" };
  }

  if (typeof original === "number") {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return { ok: false, error: "err_number_invalid" };
    return { ok: true, value: n };
  }

  const nk = numericKey(original);
  if (nk) return rebuildNumber(KEY_TO_KIND[nk], text.trim());

  return { ok: false, error: "err_inline_unsupported" };
}

/** ExtJSON update doc that $sets a field (dotted key addresses nested paths natively in Mongo). */
export function buildSetUpdate(key: string, value: unknown): string {
  return JSON.stringify({ $set: { [key]: value } });
}

/** Immutably set a dot-path on a document, cloning each object along the way. */
export function setByPath(doc: Doc, path: string, value: unknown): Doc {
  const [key, ...rest] = path.split(".");
  if (rest.length === 0) return { ...doc, [key]: value };
  const child = doc[key];
  const childDoc = (child !== null && typeof child === "object" && !Array.isArray(child)) ? child as Doc : {};
  return { ...doc, [key]: setByPath(childDoc, rest.join("."), value) };
}
