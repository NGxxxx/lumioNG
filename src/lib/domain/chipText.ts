// src/lib/domain/chipText.ts — typed input ↔ chip value text, and the plain-language parts of a
// chip for display. Pure.
import type { Chip, ChipOp } from "./filterChips";
import type { ChipValueType } from "./fieldInfo";

export const OPS_WITHOUT_VALUE: ReadonlySet<ChipOp> = new Set(["exists", "notExists", "today", "isTrue", "isFalse"]);

/** How many values an operator takes. */
export function valueCountFor(op: ChipOp): 0 | 1 | 2 | "many" {
  if (OPS_WITHOUT_VALUE.has(op)) return 0;
  if (op === "between") return 2;
  if (op === "in") return "many";
  return 1;
}

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * JSON text for what the user typed, by the field's type; null when it doesn't fit the type.
 * A bare day (`2024-01-31`) is local midnight — the same day boundary `today`/`lastDays` use —
 * or the day's last millisecond with `endOfDay` (the end of a date range includes that whole day).
 */
export function valueTextFor(type: ChipValueType, raw: string, opts: { endOfDay?: boolean } = {}): string | null {
  const t = raw.trim();
  switch (type) {
    case "number":
      return NUMBER_RE.test(t) ? t : null;
    case "objectId":
      return /^[0-9a-fA-F]{24}$/.test(t) ? JSON.stringify({ $oid: t.toLowerCase() }) : null;
    case "date": {
      const day = DAY_RE.exec(t);
      const d = day
        ? opts.endOfDay
          ? new Date(+day[1], +day[2] - 1, +day[3], 23, 59, 59, 999)
          : new Date(+day[1], +day[2] - 1, +day[3])
        : new Date(t);
      return t && !Number.isNaN(d.getTime()) ? JSON.stringify({ $date: d.toISOString() }) : null;
    }
    case "bool":
      return t === "true" || t === "false" ? t : null;
    case "unknown":
      return NUMBER_RE.test(t) || t === "true" || t === "false" || t === "null" ? t : JSON.stringify(t);
    default:
      return JSON.stringify(t);
  }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Milliseconds of an ExtJSON `$date` (relaxed ISO string or canonical `{$numberLong}`); null otherwise. */
function dateMs(d: unknown): number | null {
  const ms =
    typeof d === "string" ? Date.parse(d)
    : d && typeof d === "object" && typeof (d as { $numberLong?: unknown }).$numberLong === "string" ? Number((d as { $numberLong: string }).$numberLong)
    : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Local `YYYY-MM-DD` for a day boundary (midnight or the day's last ms), else `YYYY-MM-DD HH:mm[:ss]`. */
function localDateText(ms: number): string {
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const t = [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  if (t.every((x) => x === 0) || (t[0] === 23 && t[1] === 59 && t[2] === 59 && t[3] === 999)) return day;
  return `${day} ${pad(t[0])}:${pad(t[1])}${t[2] || t[3] ? `:${pad(t[2])}` : ""}`;
}

/** A value's JSON text as a person would read it. */
export function displayValue(text: string): string {
  return readable(text, false);
}

/** Like displayValue, but complete enough to type back (full ObjectId hex) — for editors. */
export function editValue(text: string): string {
  return readable(text, true);
}

function readable(text: string, full: boolean): string {
  try {
    const v = JSON.parse(text) as unknown;
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.$oid === "string") return full ? o.$oid : `…${o.$oid.slice(-6)}`;
      if ("$date" in o) {
        const ms = dateMs(o.$date);
        if (ms !== null) return localDateText(ms);
      }
      const k = Object.keys(o)[0];
      if (k && k.startsWith("$number") && typeof o[k] === "string") return o[k] as string;
    }
    return text;
  } catch {
    return text;
  }
}

/** Field, operator id and value text of a chip for its label (the component translates `op`). */
export function chipParts(c: Chip): { field: string; op: ChipOp; value: string } {
  const vals = c.values.map(displayValue);
  const value = c.op === "between" ? vals.join(" – ") : c.op === "in" ? vals.join(", ") : vals[0] ?? "";
  return { field: c.field, op: c.op, value: OPS_WITHOUT_VALUE.has(c.op) ? "" : value };
}
