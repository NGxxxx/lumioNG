/** Export documents as CSV or Canonical ExtJSON (array or single-doc). */
import type { Doc } from "./doc";
import { flattenPaths, getByPath } from "./schema";
import { describeValue } from "./extjson";

/** Escape a CSV field: wraps in quotes when it contains , " \n \r; doubles inner quotes. */
export function escapeCsv(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** Raw (unescaped) cell value for CSV. undefined → ""; scalar/ObjectId/Date/number →
 *  describeValue().display; array/object → full JSON.stringify. */
export function csvCell(value: unknown): string {
  if (value === undefined) return "";
  const info = describeValue(value);
  if (info.type === "object" || info.type === "array") {
    return JSON.stringify(value);
  }
  return info.display;
}

/** Serialize docs to CSV: columns from flattenPaths, header row first, cells via csvCell + escapeCsv. */
export function toCsv(docs: Doc[]): string {
  if (docs.length === 0) return "";
  const paths = flattenPaths(docs);
  const header = paths.map(escapeCsv).join(",");
  const rows = docs.map((d) =>
    paths.map((p) => escapeCsv(csvCell(getByPath(d, p)))).join(","),
  );
  return [header, ...rows].join("\n");
}

/** Serialize docs as a Canonical ExtJSON array, pretty-printed at 2 spaces. */
export function toJsonArray(docs: Doc[]): string {
  return JSON.stringify(docs, null, 2);
}

