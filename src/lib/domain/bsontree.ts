import { describeValue, type BsonType } from "./extjson";
import { rebuildNumber } from "./bsonnum";
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
    case "int":
    case "long":
    case "double":
    case "decimal":
      return rebuildNumber(type, t);
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

/**
 * Validate tên field mới khi thêm vào object. Trả message lỗi (đúng chuỗi người
 * dùng đang thấy) hoặc null nếu hợp lệ. Tên được trim trước khi kiểm tra.
 */
export function validateNewFieldName(name: string, existingKeys: string[]): string | null {
  const n = name.trim();
  if (n === "") return "Tên field không được rỗng.";
  if (existingKeys.includes(n)) return "Field đã tồn tại.";
  return null;
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
