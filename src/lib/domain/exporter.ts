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

/** Escape a single-quoted SQL string literal (doubles embedded quotes, SQL's own escape rule). */
export function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** SQL literal for one cell: NULL, an unquoted number/boolean, or a quoted string.
 *  Object/array/ObjectId/Date are written as their display/JSON text, not their original type. */
export function sqlLiteral(value: unknown): string {
  if (value === undefined || value === null) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const info = describeValue(value);
  // Emit int/long/decimal's exact digit string as-is — Number() would corrupt values outside float64's 53-bit safe range.
  if (info.type === "int" || info.type === "long" || info.type === "decimal") {
    return /^-?\d+(\.\d+)?$/.test(info.display) ? info.display : "NULL";
  }
  if (info.type === "double") {
    const n = Number(info.display);
    return Number.isFinite(n) ? String(n) : "NULL";
  }
  const text = info.type === "object" || info.type === "array" ? JSON.stringify(value) : info.display;
  return `'${escapeSqlString(text)}'`;
}

/** Top-level field union across every doc, `_id` first (unlike CSV's flattenPaths, nested objects/arrays stay one field). */
function topLevelColumns(docs: Doc[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    }
  }
  const idx = order.indexOf("_id");
  if (idx > 0) {
    order.splice(idx, 1);
    order.unshift("_id");
  }
  return order;
}

type SqlColType = "INTEGER" | "REAL" | "BOOLEAN" | "TEXT";

/** SQL column type per field, from the BSON types seen across every doc; one pass over `docs`
 *  for all columns at once (not one pass per column). */
function sqlColumnTypes(docs: Doc[], columns: string[]): Record<string, SqlColType> {
  const flags = new Map<string, { number: boolean; bool: boolean; other: boolean; float: boolean }>(
    columns.map((c) => [c, { number: false, bool: false, other: false, float: false }]),
  );
  for (const d of docs) {
    for (const c of columns) {
      const v = d[c];
      if (v === undefined || v === null) continue;
      const f = flags.get(c)!;
      if (typeof v === "boolean") { f.bool = true; continue; }
      const t = describeValue(v).type;
      if (t === "int" || t === "long" || t === "double" || t === "decimal") {
        f.number = true;
        if (t === "double" || t === "decimal") f.float = true;
      } else {
        f.other = true;
      }
    }
  }
  const result: Record<string, SqlColType> = {};
  for (const c of columns) {
    const f = flags.get(c)!;
    result[c] = f.other || (f.number && f.bool) ? "TEXT" : f.bool ? "BOOLEAN" : f.number ? (f.float ? "REAL" : "INTEGER") : "TEXT";
  }
  return result;
}

/** Quote a SQL identifier (table/column name) so any character is valid inside it. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Serializes docs as `CREATE TABLE` + `INSERT INTO` statements (generic ANSI SQL); not lossless — BSON types come back as plain strings on reimport. */
export function toSql(docs: Doc[], tableName: string): string {
  if (docs.length === 0) return "";
  const table = quoteIdent(tableName);
  const columns = topLevelColumns(docs);
  const types = sqlColumnTypes(docs, columns);

  const createCols = columns.map((c) => `  ${quoteIdent(c)} ${types[c]}`).join(",\n");
  const create = `CREATE TABLE ${table} (\n${createCols}\n);`;

  const colList = columns.map(quoteIdent).join(", ");
  const inserts = docs.map((d) => {
    const values = columns.map((c) => sqlLiteral(d[c])).join(", ");
    return `INSERT INTO ${table} (${colList}) VALUES (${values});`;
  });

  return [create, "", ...inserts].join("\n");
}

