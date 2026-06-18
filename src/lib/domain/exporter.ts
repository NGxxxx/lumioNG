import type { Doc } from "./columns";
import { flattenPaths, getByPath } from "./schema";
import { describeValue } from "./extjson";

/** Escape một trường CSV: bọc trong dấu " khi chứa , " \n \r; nhân đôi " bên trong. */
export function escapeCsv(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** Giá trị một ô CSV (chưa escape). undefined → ""; scalar/ObjectId/Date/number →
 *  describeValue().display; array/object → JSON.stringify đầy đủ. */
export function csvCell(value: unknown): string {
  if (value === undefined) return "";
  const info = describeValue(value);
  if (info.type === "object" || info.type === "array") {
    return JSON.stringify(value);
  }
  return info.display;
}

/** CSV: cột = flattenPaths(docs); hàng đầu là header; ô qua csvCell + escapeCsv. */
export function toCsv(docs: Doc[]): string {
  if (docs.length === 0) return "";
  const paths = flattenPaths(docs);
  const header = paths.map(escapeCsv).join(",");
  const rows = docs.map((d) =>
    paths.map((p) => escapeCsv(csvCell(getByPath(d, p)))).join(","),
  );
  return [header, ...rows].join("\n");
}

/** Mảng Canonical ExtJSON, pretty 2-space. */
export function toJsonArray(docs: Doc[]): string {
  return JSON.stringify(docs, null, 2);
}
