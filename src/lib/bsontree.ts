import { describeValue, type BsonType } from "./extjson";
import type { RebuildResult } from "./celledit";

/** Kiểu lá có ô nhập riêng trong tree (Tier 2). */
export type LeafInputType =
  | "string" | "bool" | "int" | "long" | "double" | "decimal" | "date" | "objectId";

/** Kiểu có thể chọn khi thêm field/phần tử mới. */
export type AddableType = LeafInputType | "null" | "object" | "array";

export const ADDABLE_TYPES: AddableType[] = [
  "string", "int", "long", "double", "decimal", "bool", "date", "objectId", "null", "object", "array",
];

/** Phải đồng bộ với LeafInputType (8 kiểu lá có ô nhập). */
const INPUT_TYPES = new Set<BsonType>([
  "string", "bool", "int", "long", "double", "decimal", "date", "objectId",
]);

/** Kiểu BSON của một giá trị ExtJSON (dùng lại describeValue). */
export function nodeType(value: unknown): BsonType {
  return describeValue(value).type;
}

export function isContainer(type: BsonType): boolean {
  return type === "object" || type === "array";
}

/** Kiểu lá có ô nhập sửa được trong tree? (binary/null/object/array/unknown: không) */
export function hasInput(type: BsonType): boolean {
  return INPUT_TYPES.has(type);
}

/** Text thô nạp vào ô khi render một lá. */
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
 * Dựng lại giá trị ExtJSON đúng kiểu `type` từ text user gõ.
 * Lưu ý: trùng một phần luật số với celledit.rebuildValue (cố ý — celledit
 * khoá theo runtime của giá trị gốc cho inline-edit 2b; bsontree khoá theo
 * tên kiểu cho tree 2c và là superset có thêm date/objectId).
 */
export function rebuildLeaf(type: LeafInputType, text: string): RebuildResult {
  const t = text.trim();
  switch (type) {
    case "string":
      return { ok: true, value: text };
    case "bool":
      if (t === "true") return { ok: true, value: true };
      if (t === "false") return { ok: true, value: false };
      return { ok: false, error: 'Giá trị bool phải là "true" hoặc "false".' };
    case "int": {
      const n = Number(t);
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647)
        return { ok: false, error: "Cần số nguyên 32-bit." };
      return { ok: true, value: { $numberInt: String(n) } };
    }
    case "long": {
      if (!/^-?\d+$/.test(t)) return { ok: false, error: "Cần số nguyên." };
      const big = BigInt(t);
      if (big < -9223372036854775808n || big > 9223372036854775807n)
        return { ok: false, error: "Số vượt quá dải 64-bit." };
      return { ok: true, value: { $numberLong: t } };
    }
    case "double": {
      const n = Number(t);
      if (t === "" || !Number.isFinite(n)) return { ok: false, error: "Số không hợp lệ." };
      return { ok: true, value: { $numberDouble: t } };
    }
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: "Số thập phân không hợp lệ." };
      return { ok: true, value: { $numberDecimal: t } };
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return { ok: false, error: "Ngày giờ không hợp lệ (cần ISO-8601)." };
      const ms = Date.parse(t);
      if (Number.isNaN(ms)) return { ok: false, error: "Ngày giờ không hợp lệ (cần ISO-8601)." };
      return { ok: true, value: { $date: { $numberLong: String(ms) } } };
    }
    case "objectId":
      if (!/^[0-9a-fA-F]{24}$/.test(t)) return { ok: false, error: "ObjectId cần 24 ký tự hex." };
      return { ok: true, value: { $oid: t } };
  }
}

/** Giá trị rỗng đúng kiểu khi thêm field/phần tử mới (tất định, không dùng Date.now). */
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
