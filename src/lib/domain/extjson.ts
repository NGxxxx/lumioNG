/** Describe and display Canonical Extended JSON values; extract numeric wrapper values. */
export type BsonType =
  | "objectId" | "date" | "int" | "long" | "double" | "decimal"
  | "binary" | "string" | "bool" | "null" | "object" | "array" | "unknown";

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

function previewJson(v: unknown, max = 80): string {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Above this length, rendering a value's full text into the DOM is what makes the UI lag on multi-MB string fields — truncate for *display only*; callers needing the exact value (Copy, export) must use the original. */
export const MAX_DISPLAY_LEN = 5000;

/** Truncate arbitrary display text for rendering; a no-op under the threshold. */
export function truncateForDisplay(s: string, max = MAX_DISPLAY_LEN): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
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
