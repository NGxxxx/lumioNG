/** Describe and display Canonical Extended JSON values; extract numeric wrapper values. */
export type BsonType =
  | "objectId" | "date" | "int" | "long" | "double" | "decimal"
  | "binary" | "string" | "bool" | "null" | "object" | "array" | "unknown"
  | "regex" | "timestamp" | "minKey" | "maxKey" | "code" | "symbol" | "dbPointer" | "undefined";

export interface ValueInfo {
  type: BsonType;
  display: string;
}

/** Extract a JS number from an ExtJSON numeric wrapper or a raw number; returns null when unresolvable (including NaN after parse). */
export function numFromExt(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["$numberInt", "$numberLong", "$numberDouble", "$numberDecimal"]) {
      if (k in o) {
        const n = Number(o[k]);
        return Number.isNaN(n) ? null : n;
      }
    }
  }
  return null;
}

/** Resolve an ExtJSON $date (string form or { $date: { $numberLong } } form) to an ISO string; null if not $date-shaped. */
export function dateIsoFromExt(v: unknown): string | null {
  if (v && typeof v === "object" && "$date" in (v as object)) {
    const d = (v as Record<string, unknown>).$date;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "$numberLong" in (d as object)) {
      const ms = Number((d as Record<string, unknown>).$numberLong);
      return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    }
  }
  return null;
}

function previewJson(v: unknown, max = 160): string {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Above this length, rendering a value's full text into the DOM is what makes the UI lag on multi-MB string fields — truncate for *display only*; callers needing the exact value (Copy, export) must use the original. */
export const MAX_DISPLAY_LEN = 10000;

/** Pretty-prints a string field whose content is itself valid JSON, for read-only display only (never the saved value); null if not JSON-shaped. */
export function nestedJsonPretty(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Truncate arbitrary display text for rendering; a no-op under the threshold. */
export function truncateForDisplay(s: string, max = MAX_DISPLAY_LEN): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Cheap check for whether `v` is a plain container (array/object) the tree editor can expand, without computing `describeValue`'s display text. */
export function containerKind(v: unknown): "array" | "object" | null {
  if (v === null || typeof v !== "object") return null;
  if (Array.isArray(v)) return "array";
  const o = v as Record<string, unknown>;
  if (
    "$oid" in o || "$date" in o || "$numberInt" in o || "$numberLong" in o || "$numberDouble" in o || "$numberDecimal" in o || "$binary" in o ||
    "$regularExpression" in o || "$timestamp" in o || "$minKey" in o || "$maxKey" in o || "$code" in o || "$symbol" in o || "$dbPointer" in o || "$undefined" in o
  ) {
    return null;
  }
  return "object";
}

export function describeValue(v: unknown): ValueInfo {
  if (v === null) return { type: "null", display: "null" };
  if (typeof v === "string") return { type: "string", display: v };
  if (typeof v === "boolean") return { type: "bool", display: String(v) };
  if (typeof v === "number") return { type: "double", display: String(v) };

  if (Array.isArray(v)) return { type: "array", display: previewJson(v) };

  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$oid" in o) return { type: "objectId", display: String(o.$oid) };
    if ("$date" in o) {
      const d = o.$date;
      let display: string;
      if (typeof d === "string") {
        display = d;
      } else if (d && typeof d === "object" && "$numberLong" in (d as object)) {
        const ms = Number((d as Record<string, unknown>).$numberLong);
        display = new Date(ms).toISOString();
      } else {
        display = previewJson(d);
      }
      return { type: "date", display };
    }
    if ("$numberInt" in o) return { type: "int", display: String(o.$numberInt) };
    if ("$numberLong" in o) return { type: "long", display: String(o.$numberLong) };
    if ("$numberDouble" in o) return { type: "double", display: String(o.$numberDouble) };
    if ("$numberDecimal" in o) return { type: "decimal", display: String(o.$numberDecimal) };
    if ("$binary" in o) {
      const b = o.$binary as Record<string, unknown> | undefined;
      const len = typeof b?.base64 === "string" ? (b.base64 as string).length : 0;
      return { type: "binary", display: `Binary(${len} b64 chars)` };
    }
    if ("$regularExpression" in o) {
      const r = o.$regularExpression as Record<string, unknown> | undefined;
      return { type: "regex", display: `/${String(r?.pattern ?? "")}/${String(r?.options ?? "")}` };
    }
    if ("$timestamp" in o) {
      const t = o.$timestamp as Record<string, unknown> | undefined;
      return { type: "timestamp", display: `Timestamp(${String(t?.t ?? 0)}, ${String(t?.i ?? 0)})` };
    }
    if ("$minKey" in o) return { type: "minKey", display: "MinKey()" };
    if ("$maxKey" in o) return { type: "maxKey", display: "MaxKey()" };
    if ("$code" in o) {
      const scope = "$scope" in o ? ` ${previewJson(o.$scope)}` : "";
      return { type: "code", display: `${String(o.$code)}${scope}` };
    }
    if ("$symbol" in o) return { type: "symbol", display: String(o.$symbol) };
    if ("$dbPointer" in o) {
      const p = o.$dbPointer as Record<string, unknown> | undefined;
      const id = p?.$id;
      const idStr = id && typeof id === "object" && "$oid" in (id as object)
        ? String((id as Record<string, unknown>).$oid)
        : previewJson(id);
      return { type: "dbPointer", display: `DBPointer(${String(p?.$ref ?? "")}, ${idStr})` };
    }
    if ("$undefined" in o) return { type: "undefined", display: "undefined" };
    return { type: "object", display: previewJson(o) };
  }

  return { type: "unknown", display: String(v) };
}

/** Full clipboard text for a value: containers serialize to complete pretty JSON
 *  (their `display` is an 80-char preview); leaves copy their display text. */
export function clipboardTextOf(v: unknown): string {
  const info = describeValue(v);
  if (info.type === "object" || info.type === "array") return JSON.stringify(v, null, 2);
  return info.display;
}
