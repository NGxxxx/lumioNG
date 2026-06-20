import { rebuildNumber, type NumericKind } from "./bsonnum";
import { editTextOf } from "./bsontree";

export type RebuildResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Text thô nạp vào input khi bắt đầu sửa (định nghĩa chung ở bsontree). */
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

/** Cell có thể sửa inline? _id và mọi kiểu không-scalar đều không. */
export function isInlineEditable(key: string, value: unknown): boolean {
  if (key === "_id") return false;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  return numericKey(value) !== null;
}

/** Dựng lại giá trị đúng kiểu BSON của `original` từ text user gõ. */
export function rebuildValue(original: unknown, text: string): RebuildResult {
  if (typeof original === "string") return { ok: true, value: text };

  if (typeof original === "boolean") {
    if (text === "true") return { ok: true, value: true };
    if (text === "false") return { ok: true, value: false };
    return { ok: false, error: 'Giá trị bool phải là "true" hoặc "false".' };
  }

  if (typeof original === "number") {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return { ok: false, error: "Số không hợp lệ." };
    return { ok: true, value: n };
  }

  const nk = numericKey(original);
  if (nk) return rebuildNumber(KEY_TO_KIND[nk], text.trim());

  return { ok: false, error: "Kiểu giá trị không hỗ trợ sửa inline." };
}
