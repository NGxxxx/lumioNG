/** Logic-màu thuần cho hiển thị BSON. Không phụ thuộc Svelte/Tauri. */

export type ValueKind =
  | "string" | "number" | "bool" | "objectid" | "date"
  | "null" | "key" | "func" | "brace" | "op";

const NEUTRAL_BADGE = { color: "#555", bg: "#eee" };
const TYPE_BADGE: Record<string, { color: string; bg: string }> = {
  ObjectId: { color: "#6b3fa0", bg: "#f1ecf8" },
  String: { color: "#1f7a37", bg: "#e9f5ed" },
  Double: { color: "#1c00cf", bg: "#e9ecfb" },
  Int32: { color: "#1c00cf", bg: "#e9ecfb" },
  Int64: { color: "#1c00cf", bg: "#e9ecfb" },
  Object: { color: "#7b53b8", bg: "#f1ecf8" },
  Array: { color: "#a07b2f", bg: "#f7f0e2" },
  Boolean: { color: "#aa0d91", bg: "#fbe9f6" },
  Date: { color: "#267f4e", bg: "#e7f3ec" },
};

/** Cặp màu badge cho một BSON type; kiểu lạ → trung tính. */
export function bsonTypeBadge(type: string): { color: string; bg: string } {
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

/** Gợi ý màu pill theo quy ước trạng thái thường gặp; không khớp → trung tính. */
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

/** Màu cho một loại token giá trị JSON/mongosh. */
export function jsonValueColor(kind: ValueKind): string {
  return VALUE_COLOR[kind];
}
