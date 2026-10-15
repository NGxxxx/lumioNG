import { describeValue, dateIsoFromExt, containerKind, type BsonType } from "./extjson";

export type CellKind = BsonType | "missing";

export interface CellPreview {
  text: string;
  kind: CellKind;
  /** Hover tooltip (full ISO UTC for dates). */
  title?: string;
  align: "left" | "right";
}

const NUMERIC: ReadonlySet<BsonType> = new Set(["int", "long", "double", "decimal"]);

const pad = (n: number) => String(n).padStart(2, "0");

function localDateTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A value nested inside a container preview: leaves show their text, containers collapse so previews stay one level deep. */
/** No single nested value needs more than this; the whole preview is capped at `max` anyway. */
const NESTED_MAX = 200;

function nestedText(v: unknown): string {
  const c = containerKind(v);
  if (c === "array") return "[…]";
  if (c === "object") return "{…}";
  // Clip long strings before they are concatenated: copying a multi-MB value only to slice it is the cost being avoided.
  if (typeof v === "string") return v.length > NESTED_MAX ? v.slice(0, NESTED_MAX) : v;
  return describeValue(v).display;
}

/** `{ k: v, … }` built lazily — stops walking keys once `budget` chars are used, so cost is bounded by `max`, not by document size. */
function objectText(o: Record<string, unknown>, budget: number): string {
  let out = "{ ";
  let first = true;
  for (const k in o) {
    if (out.length >= budget) {
      out += ", …";
      break;
    }
    out += (first ? "" : ", ") + k + ": " + nestedText(o[k]);
    first = false;
  }
  return first ? "{ }" : out + " }";
}

function arrayText(a: unknown[], budget: number): string {
  if (a.length === 0) return "[ ]";
  let out = `[${a.length}] `;
  for (let i = 0; i < a.length; i++) {
    if (out.length >= budget) {
      out += ", …";
      break;
    }
    const el = a[i];
    out += (i === 0 ? "" : ", ") + (containerKind(el) === "object" ? objectText(el as Record<string, unknown>, budget) : nestedText(el));
  }
  return out;
}

/** Typed, length-capped one-line preview of a Canonical Extended JSON value for a grid cell; pure, cost bounded by `max`. */
export function previewCell(value: unknown, max = 120): CellPreview {
  if (value === undefined) return { text: "—", kind: "missing", align: "left" };

  // Containers are classified without describeValue, which would stringify the whole value.
  const c = containerKind(value);
  const kind = c ?? describeValue(value).type;
  let text: string;
  let title: string | undefined;

  if (c === "array") text = arrayText(value as unknown[], max);
  else if (c === "object") text = objectText(value as Record<string, unknown>, max);
  else if (kind === "date") {
    const iso = dateIsoFromExt(value);
    const local = iso ? localDateTime(iso) : null;
    text = local ?? describeValue(value).display;
    if (iso) title = iso;
  } else text = describeValue(value).display;

  if (text.length > max) text = text.slice(0, max - 1) + "…";
  return { text, kind, ...(title ? { title } : {}), align: NUMERIC.has(kind) ? "right" : "left" };
}
