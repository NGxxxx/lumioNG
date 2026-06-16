export type RebuildResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const NUMERIC_KEYS = ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"] as const;

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

/** Text thô nạp vào input khi bắt đầu sửa. */
export function editTextOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const nk = numericKey(value);
  if (nk) return String((value as Record<string, unknown>)[nk]);
  return "";
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
  const t = text.trim();
  if (nk === "$numberInt") {
    const n = Number(t);
    if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) return { ok: false, error: "Cần số nguyên 32-bit." };
    return { ok: true, value: { $numberInt: String(n) } };
  }
  if (nk === "$numberLong") {
    if (!/^-?\d+$/.test(t)) return { ok: false, error: "Cần số nguyên." };
    const big = BigInt(t);
    if (big < -9223372036854775808n || big > 9223372036854775807n) {
      return { ok: false, error: "Số vượt quá dải 64-bit." };
    }
    return { ok: true, value: { $numberLong: t } };
  }
  if (nk === "$numberDouble") {
    const n = Number(t);
    if (t === "" || !Number.isFinite(n)) return { ok: false, error: "Số không hợp lệ." };
    return { ok: true, value: { $numberDouble: t } };
  }
  if (nk === "$numberDecimal") {
    if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Số thập phân không hợp lệ." };
    return { ok: true, value: { $numberDecimal: t } };
  }

  return { ok: false, error: "Kiểu giá trị không hỗ trợ sửa inline." };
}
