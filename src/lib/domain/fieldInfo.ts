// src/lib/domain/fieldInfo.ts — what the filter chips / builder forms know about a field: value
// type, presence, whether an index leads with it, and the distinct values seen in a sample. Pure.
import type { BsonType } from "./extjson";
import type { ColumnField } from "./schema";
import { getByPath } from "./schema";
import type { Doc } from "./doc";

export type ChipValueType = "string" | "number" | "date" | "array" | "bool" | "objectId" | "unknown";
export type FieldInfo = { path: string; type: ChipValueType; presence: number | null; indexed: boolean };

export function chipTypeOf(t: BsonType | undefined): ChipValueType {
  switch (t) {
    case "int": case "long": case "double": case "decimal": return "number";
    case "date": return "date";
    case "objectId": return "objectId";
    case "array": return "array";
    case "bool": return "bool";
    case "string": return "string";
    default: return "unknown";
  }
}

/** Distinct values of `path` in `docs` as JSON text (first-seen order); [] when more than `max`. */
export function distinctValueTexts(docs: Doc[], path: string, max = 20): string[] {
  const seen = new Set<string>();
  for (const d of docs) {
    const v = getByPath(d, path);
    if (v === undefined || (typeof v === "object" && v !== null && !isWrapper(v))) continue;
    seen.add(JSON.stringify(v));
    if (seen.size > max) return [];
  }
  return [...seen];
}

function isWrapper(v: object): boolean {
  if (Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && keys[0].startsWith("$");
}

/** First key of every index (from raw listIndexes JSON) — fields a filter can use an index for. */
export function indexedLeadingFields(rawIndexes: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of rawIndexes) {
    try {
      const key = (JSON.parse(raw) as { key?: Record<string, unknown> }).key;
      const first = key ? Object.keys(key)[0] : undefined;
      if (first) out.add(first);
    } catch {
      // ignore unreadable entries
    }
  }
  return out;
}

export function fieldInfos(columns: ColumnField[], indexed: Set<string>): FieldInfo[] {
  return columns.map((c) => ({ path: c.path, type: chipTypeOf(c.type), presence: c.presence ?? null, indexed: indexed.has(c.path) }));
}
