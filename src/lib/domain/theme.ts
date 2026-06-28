/** Pure color logic for BSON display. No Svelte or Tauri dependencies. */

export type ValueKind =
  | "string" | "number" | "bool" | "objectid" | "date"
  | "null" | "key" | "func" | "brace" | "op";

import type { BsonType } from "./extjson";

const NEUTRAL_BADGE = { color: "#555", bg: "#eee" };
const TYPE_BADGE: Partial<Record<BsonType, { color: string; bg: string }>> = {
  objectId: { color: "#6b3fa0", bg: "#f1ecf8" },
  string: { color: "#1f7a37", bg: "#e9f5ed" },
  double: { color: "#1c00cf", bg: "#e9ecfb" },
  int: { color: "#1c00cf", bg: "#e9ecfb" },
  long: { color: "#1c00cf", bg: "#e9ecfb" },
  decimal: { color: "#1c00cf", bg: "#e9ecfb" },
  object: { color: "#7b53b8", bg: "#f1ecf8" },
  array: { color: "#a07b2f", bg: "#f7f0e2" },
  bool: { color: "#aa0d91", bg: "#fbe9f6" },
  date: { color: "#267f4e", bg: "#e7f3ec" },
  binary: { color: "#8a6d3b", bg: "#f3eddf" },
};

/** Badge color pair for a BSON type; unknown/unmapped → neutral. */
export function bsonTypeBadge(type: BsonType): { color: string; bg: string } {
  return TYPE_BADGE[type] ?? NEUTRAL_BADGE;
}

const NEUTRAL_PILL = { color: "#666", bg: "#ededed" };
const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  paid: { color: "#1f7a37", bg: "#e6f4ea" },
  pending: { color: "#8a6300", bg: "#fff3d4" },
  shipped: { color: "#1565c0", bg: "#e3f0fc" },
  refunded: { color: "#666", bg: "#ededed" },
  cancelled: { color: "#c0392b", bg: "#fdeaea" },
};

/** Suggest a pill color based on common status conventions; unknown value → neutral. */
export function statusPill(value: string): { color: string; bg: string } {
  return STATUS_PILL[value] ?? NEUTRAL_PILL;
}

const VALUE_COLOR: Record<ValueKind, string> = {
  string: "#c41a16",
  number: "#1c00cf",
  bool: "#aa0d91",
  objectid: "#6b3fa0",
  date: "#267f4e",
  null: "#777",
  key: "#9a2f8f",
  func: "#267f4e",
  brace: "#7b53b8",
  op: "#1565c0",
};

/** Color for a JSON/mongosh value token kind. */
export function jsonValueColor(kind: ValueKind): string {
  return VALUE_COLOR[kind];
}

/** Map a BSON type to its color `ValueKind`, or null when it has no dedicated color. */
export function bsonValueKind(type: BsonType): ValueKind | null {
  switch (type) {
    case "string": return "string";
    case "int": case "long": case "double": case "decimal": return "number";
    case "bool": return "bool";
    case "objectId": return "objectid";
    case "date": return "date";
    case "null": return "null";
    default: return null;
  }
}
