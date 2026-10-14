/** Pure color logic for BSON display. No Svelte or Tauri dependencies. */

export type ValueKind =
  | "string" | "number" | "bool" | "objectid" | "date"
  | "null" | "key" | "func" | "brace" | "op";

import type { BsonType } from "./extjson";

function tint(hue: string, pct: number): string {
  return `color-mix(in srgb, var(--c-${hue}) ${pct}%, var(--c-base))`;
}

const NEUTRAL_BADGE = { color: "var(--c-subtext0)", bg: "var(--c-surface0)" };
const TYPE_BADGE: Partial<Record<BsonType, { color: string; bg: string }>> = {
  objectId: { color: "var(--c-mauve)", bg: tint("mauve", 12) },
  string: { color: "var(--c-green)", bg: tint("green", 12) },
  double: { color: "var(--c-blue)", bg: tint("blue", 12) },
  int: { color: "var(--c-blue)", bg: tint("blue", 12) },
  long: { color: "var(--c-blue)", bg: tint("blue", 12) },
  decimal: { color: "var(--c-blue)", bg: tint("blue", 12) },
  object: { color: "var(--c-mauve)", bg: tint("mauve", 12) },
  array: { color: "var(--c-peach)", bg: tint("peach", 12) },
  bool: { color: "var(--c-pink)", bg: tint("pink", 12) },
  date: { color: "var(--c-teal)", bg: tint("teal", 12) },
  binary: { color: "var(--c-peach)", bg: tint("peach", 12) },
};

/** Badge color pair for a BSON type; unknown/unmapped → neutral. */
export function bsonTypeBadge(type: BsonType): { color: string; bg: string } {
  return TYPE_BADGE[type] ?? NEUTRAL_BADGE;
}

const NEUTRAL_PILL = NEUTRAL_BADGE;
const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  paid: { color: "var(--c-green)", bg: tint("green", 14) },
  pending: { color: "var(--c-yellow)", bg: tint("yellow", 14) },
  shipped: { color: "var(--c-blue)", bg: tint("blue", 14) },
  refunded: NEUTRAL_PILL,
  cancelled: { color: "var(--c-red)", bg: tint("red", 10) },
};

/** Suggest a pill color based on common status conventions; unknown value → neutral. */
export function statusPill(value: string): { color: string; bg: string } {
  return STATUS_PILL[value] ?? NEUTRAL_PILL;
}

const VALUE_COLOR: Record<ValueKind, string> = {
  string: "var(--c-green)",
  number: "var(--c-blue)",
  bool: "var(--c-pink)",
  objectid: "var(--c-mauve)",
  date: "var(--c-teal)",
  null: "var(--c-overlay0)",
  key: "var(--c-mauve)",
  func: "var(--c-teal)",
  brace: "var(--c-lavender)",
  op: "var(--c-sapphire)",
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
