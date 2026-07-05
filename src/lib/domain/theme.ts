/** Pure color logic for BSON display. No Svelte or Tauri dependencies. */

export type ValueKind =
  | "string" | "number" | "bool" | "objectid" | "date"
  | "null" | "key" | "func" | "brace" | "op";

import type { BsonType } from "./extjson";

function tint(hue: string, pct: number): string {
  return `color-mix(in srgb, var(--ctp-${hue}) ${pct}%, var(--ctp-base))`;
}

const NEUTRAL_BADGE = { color: "var(--ctp-subtext0)", bg: "var(--ctp-surface0)" };
const TYPE_BADGE: Partial<Record<BsonType, { color: string; bg: string }>> = {
  objectId: { color: "var(--ctp-mauve)", bg: tint("mauve", 12) },
  string: { color: "var(--ctp-green)", bg: tint("green", 12) },
  double: { color: "var(--ctp-blue)", bg: tint("blue", 12) },
  int: { color: "var(--ctp-blue)", bg: tint("blue", 12) },
  long: { color: "var(--ctp-blue)", bg: tint("blue", 12) },
  decimal: { color: "var(--ctp-blue)", bg: tint("blue", 12) },
  object: { color: "var(--ctp-mauve)", bg: tint("mauve", 12) },
  array: { color: "var(--ctp-peach)", bg: tint("peach", 12) },
  bool: { color: "var(--ctp-pink)", bg: tint("pink", 12) },
  date: { color: "var(--ctp-teal)", bg: tint("teal", 12) },
  binary: { color: "var(--ctp-peach)", bg: tint("peach", 12) },
};

/** Badge color pair for a BSON type; unknown/unmapped → neutral. */
export function bsonTypeBadge(type: BsonType): { color: string; bg: string } {
  return TYPE_BADGE[type] ?? NEUTRAL_BADGE;
}

const NEUTRAL_PILL = NEUTRAL_BADGE;
const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  paid: { color: "var(--ctp-green)", bg: tint("green", 14) },
  pending: { color: "var(--ctp-yellow)", bg: tint("yellow", 14) },
  shipped: { color: "var(--ctp-blue)", bg: tint("blue", 14) },
  refunded: NEUTRAL_PILL,
  cancelled: { color: "var(--ctp-red)", bg: tint("red", 10) },
};

/** Suggest a pill color based on common status conventions; unknown value → neutral. */
export function statusPill(value: string): { color: string; bg: string } {
  return STATUS_PILL[value] ?? NEUTRAL_PILL;
}

const VALUE_COLOR: Record<ValueKind, string> = {
  string: "var(--ctp-green)",
  number: "var(--ctp-blue)",
  bool: "var(--ctp-pink)",
  objectid: "var(--ctp-mauve)",
  date: "var(--ctp-teal)",
  null: "var(--ctp-overlay0)",
  key: "var(--ctp-mauve)",
  func: "var(--ctp-teal)",
  brace: "var(--ctp-lavender)",
  op: "var(--ctp-sapphire)",
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
