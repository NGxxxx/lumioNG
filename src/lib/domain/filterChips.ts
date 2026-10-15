/**
 * Filter chip codec. Values are carried as their ORIGINAL JSON text (never round-tripped through
 * JSON.parse/stringify), so big ints, `1.0` and ExtJSON wrappers survive byte-for-byte.
 *
 * Choices:
 * - Output format of `filterFromChips`: `{"a": 1, "b": {"$ne": 2}}` (one space after colons and
 *   commas); chip order = key order; no chips → `{}`. Chips sharing a field go into one top-level
 *   `$and` (at the field's first position) — a JSON object cannot repeat a key, and the server would
 *   keep only the last one. `chipsFromFilter` reads that `$and` back as chips.
 * - `elemMatch` (array contains) emits `"field": v`, which parses back as `eq`.
 * - `before`/`after` parse back as `lt`/`gt`; `lastDays` as `gte`; `today` ({$gte,$lt}) as `between`
 *   with `upperExclusive`, so the `$lt` end is written back unchanged.
 * - `contains`/`startsWith` values[0] is the JSON string of the literal text; a regex that is not a
 *   pure escaped literal is not chip-representable.
 */

import type { ChipValueType } from "./fieldInfo";
import { valueTextFor } from "./chipText";

export type ChipOp =
  | "eq" | "ne" | "contains" | "startsWith" | "in" | "exists" | "notExists"
  | "gt" | "gte" | "lt" | "lte" | "between" | "lastDays" | "before" | "after" | "today"
  | "elemMatch" | "size" | "isTrue" | "isFalse";
export type Chip = {
  field: string;
  op: ChipOp;
  values: string[] /* original JSON text of each value */;
  /** `between` only: the end was written as `$lt` (kept so it is never rewritten to `$lte`). */
  upperExclusive?: true;
};

// ---------- scanner over JSON text (assumes text already validated by JSON.parse) ----------

function skipWs(t: string, i: number): number {
  while (i < t.length && /\s/.test(t[i])) i++;
  return i;
}

/** End index (exclusive) of the value starting at `i`. */
function scanValue(t: string, i: number): number {
  const ch = t[i];
  if (ch === '"') return scanString(t, i);
  if (ch === "{") return scanContainer(t, i, "}");
  if (ch === "[") return scanContainer(t, i, "]");
  let j = i;
  while (j < t.length && !/[\s,}\]]/.test(t[j])) j++;
  return j;
}

function scanString(t: string, i: number): number {
  let j = i + 1;
  while (j < t.length) {
    if (t[j] === "\\") j += 2;
    else if (t[j] === '"') return j + 1;
    else j++;
  }
  return j;
}

function scanContainer(t: string, i: number, close: string): number {
  let j = skipWs(t, i + 1);
  if (t[j] === close) return j + 1;
  for (;;) {
    if (close === "}") {
      j = scanString(t, j);
      j = skipWs(t, j) + 1; // ':'
      j = skipWs(t, j);
    }
    j = scanValue(t, j);
    j = skipWs(t, j);
    if (t[j] === ",") j = skipWs(t, j + 1);
    else return j + 1;
  }
}

/** Members of the object starting at `i`, with raw value text. */
function objectEntries(t: string, i: number): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];
  let j = skipWs(t, i + 1);
  while (t[j] !== "}") {
    const kEnd = scanString(t, j);
    const key = JSON.parse(t.slice(j, kEnd)) as string;
    j = skipWs(t, skipWs(t, kEnd) + 1);
    const vEnd = scanValue(t, j);
    out.push({ key, raw: t.slice(j, vEnd) });
    j = skipWs(t, vEnd);
    if (t[j] === ",") j = skipWs(t, j + 1);
  }
  return out;
}

function arrayElements(raw: string): string[] {
  const out: string[] = [];
  let j = skipWs(raw, 1);
  while (raw[j] !== "]") {
    const e = scanValue(raw, j);
    out.push(raw.slice(j, e));
    j = skipWs(raw, e);
    if (raw[j] === ",") j = skipWs(raw, j + 1);
  }
  return out;
}

// ---------- chipsFromFilter ----------

const WRAPPERS = new Set([
  "$oid", "$date", "$numberLong", "$numberDecimal", "$numberDouble", "$numberInt", "$regularExpression",
]);
const OPERATORS = new Set(["$ne", "$in", "$exists", "$gt", "$gte", "$lt", "$lte", "$regex", "$options", "$size"]);
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Inverse of escapeRegex; null when `p` is not a pure escaped literal. */
function unescapeRegex(p: string): string | null {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "\\") {
      const nx = p[i + 1];
      if (nx === undefined || !REGEX_SPECIAL.test(nx)) return null;
      out += nx;
      i++;
    } else if (REGEX_SPECIAL.test(ch)) {
      return null;
    } else out += ch;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function chipFromValue(field: string, raw: string): Chip | null {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === true) return { field, op: "isTrue", values: [] };
  if (parsed === false) return { field, op: "isFalse", values: [] };
  if (!isPlainObject(parsed)) return { field, op: "eq", values: [raw] };

  const keys = Object.keys(parsed);
  if (keys.length === 1 && WRAPPERS.has(keys[0])) return { field, op: "eq", values: [raw] };
  if (keys.length === 0 || !keys.every((k) => OPERATORS.has(k))) return null;

  const m = new Map(objectEntries(raw, 0).map((e) => [e.key, e.raw]));
  const has = (...ks: string[]) => keys.length === ks.length && ks.every((k) => m.has(k));
  const one = (k: string) => m.get(k)!;

  if (has("$ne")) return { field, op: "ne", values: [one("$ne")] };
  if (has("$in")) {
    if (!Array.isArray(parsed.$in)) return null;
    return { field, op: "in", values: arrayElements(one("$in")) };
  }
  if (has("$exists")) {
    if (typeof parsed.$exists !== "boolean") return null;
    return { field, op: parsed.$exists ? "exists" : "notExists", values: [] };
  }
  for (const [k, op] of [["$gt", "gt"], ["$gte", "gte"], ["$lt", "lt"], ["$lte", "lte"]] as const) {
    if (has(k)) return { field, op, values: [one(k)] };
  }
  if (has("$gte", "$lte")) return { field, op: "between", values: [one("$gte"), one("$lte")] };
  if (has("$gte", "$lt")) return { field, op: "between", values: [one("$gte"), one("$lt")], upperExclusive: true };
  if (has("$size")) return { field, op: "size", values: [one("$size")] };
  if (has("$regex") || has("$regex", "$options")) {
    if (typeof parsed.$regex !== "string") return null;
    const ci = m.has("$options");
    if (ci && parsed.$options !== "i") return null;
    if (ci) {
      const lit = unescapeRegex(parsed.$regex);
      return lit === null ? null : { field, op: "contains", values: [JSON.stringify(lit)] };
    }
    if (!parsed.$regex.startsWith("^")) return null;
    const lit = unescapeRegex(parsed.$regex.slice(1));
    return lit === null ? null : { field, op: "startsWith", values: [JSON.stringify(lit)] };
  }
  return null;
}

/** Parse a filter into chips; null when it cannot be expressed as chips (or is invalid JSON). */
export function chipsFromFilter(text: string): Chip[] | null {
  const t = text.trim();
  if (t === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const chips: Chip[] = [];
  const seen = new Set<string>();
  const andFields = new Set<string>();
  const add = (key: string, raw: string): boolean => {
    const chip = chipFromValue(key, raw);
    if (!chip) return false;
    chips.push(chip);
    return true;
  };
  for (const { key, raw } of objectEntries(t, 0)) {
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "$and") {
      // Only the shape filterFromChips writes: single-field conditions on plain fields.
      if (!raw.startsWith("[")) return null;
      for (const el of arrayElements(raw)) {
        if (!el.startsWith("{")) return null;
        const members = objectEntries(el, 0);
        if (members.length !== 1 || members[0].key.startsWith("$")) return null;
        if (!add(members[0].key, members[0].raw)) return null;
        andFields.add(members[0].key);
      }
      continue;
    }
    if (key.startsWith("$")) return null;
    if (!add(key, raw)) return null;
  }
  // A field both inside and outside `$and` cannot be told apart from a hand-written filter.
  if ([...andFields].some((f) => seen.has(f))) return null;
  return chips;
}

// ---------- filterFromChips ----------

function strOf(raw: string): string {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "string" ? v : String(v);
  } catch {
    return raw;
  }
}

function dateJson(d: Date): string {
  return `{"$date": ${JSON.stringify(d.toISOString())}}`;
}

function condition(chip: Chip, now: Date): string {
  const v = chip.values;
  switch (chip.op) {
    case "eq":
    case "elemMatch":
      return v[0];
    case "isTrue":
      return "true";
    case "isFalse":
      return "false";
    case "ne":
      return `{"$ne": ${v[0]}}`;
    case "in":
      return `{"$in": [${v.join(", ")}]}`;
    case "exists":
      return `{"$exists": true}`;
    case "notExists":
      return `{"$exists": false}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `{"$${chip.op}": ${v[0]}}`;
    case "before":
      return `{"$lt": ${v[0]}}`;
    case "after":
      return `{"$gt": ${v[0]}}`;
    case "between":
      return `{"$gte": ${v[0]}, "${chip.upperExclusive ? "$lt" : "$lte"}": ${v[1]}}`;
    case "contains":
      return `{"$regex": ${JSON.stringify(escapeRegex(strOf(v[0])))}, "$options": "i"}`;
    case "startsWith":
      return `{"$regex": ${JSON.stringify("^" + escapeRegex(strOf(v[0])))}}`;
    case "size":
      return `{"$size": ${v[0]}}`;
    case "lastDays": {
      const d = new Date(now.getTime());
      d.setDate(d.getDate() - Number(v[0]));
      return `{"$gte": ${dateJson(d)}}`;
    }
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return `{"$gte": ${dateJson(start)}, "$lt": ${dateJson(next)}}`;
    }
  }
}

/** Build compact filter text from chips (chip order = key order). */
export function filterFromChips(chips: Chip[], now: Date = new Date()): string {
  if (chips.length === 0) return "{}";
  const member = (c: Chip) => `${JSON.stringify(c.field)}: ${condition(c, now)}`;
  const count = new Map<string, number>();
  for (const c of chips) count.set(c.field, (count.get(c.field) ?? 0) + 1);
  const repeated = chips.filter((c) => count.get(c.field)! > 1);
  const parts: string[] = [];
  let andDone = false;
  for (const c of chips) {
    if (count.get(c.field)! === 1) parts.push(member(c));
    else if (!andDone) {
      andDone = true;
      parts.push(`"$and": [${repeated.map((r) => `{${member(r)}}`).join(", ")}]`);
    }
  }
  return `{${parts.join(", ")}}`;
}

/** Two chips that "or" can join: same field, each an `is` or `in` condition. */
export function canJoinOr(a: Chip, b: Chip): boolean {
  const ok = (c: Chip) => c.op === "eq" || c.op === "in";
  return a.field === b.field && ok(a) && ok(b);
}

/** Join chips `i` and `i + 1` with "or" into one `in` chip (values de-duplicated by text). */
export function joinOr(chips: Chip[], i: number): Chip[] {
  const a = chips[i];
  const b = chips[i + 1];
  if (!a || !b || !canJoinOr(a, b)) return chips;
  const values = [...new Set([...a.values, ...b.values])];
  return [...chips.slice(0, i), { field: a.field, op: "in", values }, ...chips.slice(i + 2)];
}

// ---------- parseQuickChip ----------

// Valid JSON numbers only: `01234` (a zip code) stays a string instead of producing invalid JSON.
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function literal(v: string, type: ChipValueType): string {
  if (v.startsWith('"') || v.startsWith("{")) {
    try {
      JSON.parse(v);
      return v;
    } catch {
      /* fall through */
    }
  }
  if (type !== "unknown") {
    const typed = valueTextFor(type, v);
    if (typed !== null) return typed;
  }
  if (NUMBER.test(v) || v === "true" || v === "false" || v === "null") return v;
  return JSON.stringify(v);
}

/**
 * Parse quick syntax: `f:v`, `f!=v`, `f>v`, `f>=v`, `f<v`, `f<=v`, `f~text`, `f:[a,b]`.
 * `typeOf` (the field's observed type) makes `_id:65a1…` an ObjectId and `zip:01234` a string.
 */
export function parseQuickChip(input: string, typeOf: (field: string) => ChipValueType = () => "unknown"): Chip | null {
  const m = /^([^\s:!<>=~]+)\s*(!=|>=|<=|:|>|<|~)\s*(.+)$/.exec(input.trim());
  if (!m) return null;
  const [, field, sym, rest] = m;
  const value = rest.trim();
  if (value === "") return null;
  const type = typeOf(field);
  const lit = (v: string) => literal(v, type);
  switch (sym) {
    case ":": {
      if (value.startsWith("[") && value.endsWith("]")) {
        const parts = value.slice(1, -1).split(",").map((s) => s.trim());
        if (parts.some((s) => s === "")) return null;
        return { field, op: "in", values: parts.map(lit) };
      }
      return { field, op: "eq", values: [lit(value)] };
    }
    case "!=":
      return { field, op: "ne", values: [lit(value)] };
    case ">":
      return { field, op: "gt", values: [lit(value)] };
    case ">=":
      return { field, op: "gte", values: [lit(value)] };
    case "<":
      return { field, op: "lt", values: [lit(value)] };
    case "<=":
      return { field, op: "lte", values: [lit(value)] };
    case "~":
      return { field, op: "contains", values: [JSON.stringify(value)] };
  }
  return null;
}

// ---------- opsForType ----------

export function opsForType(
  t: "string" | "number" | "date" | "array" | "bool" | "objectId" | "unknown",
): ChipOp[] {
  switch (t) {
    case "string":
      return ["eq", "ne", "contains", "startsWith", "in", "exists", "notExists"];
    case "number":
      return ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "exists", "notExists"];
    case "date":
      return ["lastDays", "before", "after", "between", "today", "exists", "notExists"];
    case "array":
      return ["elemMatch", "size", "exists", "notExists"];
    case "bool":
      return ["isTrue", "isFalse", "exists", "notExists"];
    case "objectId":
      return ["eq", "ne", "in", "exists", "notExists"];
    case "unknown":
      return ["eq", "ne", "exists", "notExists"];
  }
}
