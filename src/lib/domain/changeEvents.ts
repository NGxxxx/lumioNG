/** Change-stream events: turn raw events into display rows, rebuild before/after states, filter. */
import type { Doc } from "./doc";
import { diffDocs, type DocChange } from "./docDiff";
import { numFromExt, dateIsoFromExt } from "./extjson";

export type ChangeOp = "insert" | "update" | "replace" | "delete" | "other";
export const CHANGE_OPS: readonly ChangeOp[] = ["insert", "update", "replace", "delete", "other"];

/** Where an event's `before` came from: the server's pre-image (MongoDB 6.0+ with pre-images
 *  enabled), the document's previous state seen earlier in this recording, or unknown. */
export type BeforeSource = "preImage" | "session" | "none";

export interface ChangeEvent {
  seq: number;
  /** Server time of the change (wallTime, else clusterTime), ms since epoch; receive time as fallback. */
  time: number;
  op: ChangeOp;
  /** The raw operationType ("insert", "drop", "rename", "invalidate"…). */
  opType: string;
  ns: string;
  /** Canonical ExtJSON text of documentKey._id; null for collection/database events. */
  idText: string | null;
  id: unknown;
  /** Field paths an update set or removed. */
  changed: string[];
  before: Doc | null;
  after: Doc | null;
  beforeSource: BeforeSource;
  raw: Doc;
  size: number;
}

/** Identifies one document across a database- or deployment-wide recording. */
export const docKey = (ns: string, idText: string) => `${ns}|${idText}`;

function asDoc(v: unknown): Doc | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : null;
}

function opOf(t: string): ChangeOp {
  return t === "insert" || t === "update" || t === "replace" || t === "delete" ? t : "other";
}

function eventTime(raw: Doc, fallback: number): number {
  const iso = dateIsoFromExt(raw.wallTime);
  if (iso) {
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) return ms;
  }
  const ts = (raw.clusterTime as { $timestamp?: { t?: unknown } } | undefined)?.$timestamp?.t;
  const sec = numFromExt(ts);
  return sec !== null ? sec * 1000 : fallback;
}

function nsOf(raw: Doc): string {
  const ns = asDoc(raw.ns);
  if (!ns) return "";
  return typeof ns.coll === "string" ? `${ns.db}.${ns.coll}` : String(ns.db ?? "");
}

const isIndex = (seg: string) => /^\d+$/.test(seg);

/** Returns a copy of `node` with `segs` set to `value` (or removed when `value` is undefined),
 *  sharing every untouched subtree. Missing intermediates are created as documents. */
function setIn(node: unknown, segs: string[], value: unknown): unknown {
  const [head, ...rest] = segs;
  if (Array.isArray(node) && isIndex(head)) {
    const i = Number(head);
    const copy = node.slice();
    if (rest.length) copy[i] = setIn(copy[i], rest, value);
    else if (value === undefined) copy.splice(i, 1);
    else {
      while (copy.length < i) copy.push(null);
      copy[i] = value;
    }
    return copy;
  }
  const obj = asDoc(node) ?? {};
  const copy: Doc = { ...obj };
  if (rest.length) copy[head] = setIn(obj[head], rest, value);
  else if (value === undefined) delete copy[head];
  else copy[head] = value;
  return copy;
}

function getIn(node: unknown, segs: string[]): unknown {
  let cur = node;
  for (const s of segs) {
    if (Array.isArray(cur) && isIndex(s)) cur = cur[Number(s)];
    else if (asDoc(cur)) cur = (cur as Doc)[s];
    else return undefined;
  }
  return cur;
}

/** Applies an update event's `updateDescription` to the document's previous state — the exact
 *  post-update state, unlike the looked-up `fullDocument`, which may already include later writes. */
export function applyUpdateDescription(before: Doc, ud: unknown): Doc {
  const d = asDoc(ud) ?? {};
  let out: unknown = before;
  for (const t of (Array.isArray(d.truncatedArrays) ? d.truncatedArrays : []) as Doc[]) {
    const segs = String(t.field).split(".");
    const arr = getIn(out, segs);
    const size = numFromExt(t.newSize);
    if (Array.isArray(arr) && size !== null) out = setIn(out, segs, arr.slice(0, size));
  }
  for (const f of (Array.isArray(d.removedFields) ? d.removedFields : []) as string[]) {
    out = setIn(out, String(f).split("."), undefined);
  }
  for (const [path, value] of Object.entries(asDoc(d.updatedFields) ?? {})) {
    out = setIn(out, path.split("."), value);
  }
  return out as Doc;
}

function changedPaths(ud: unknown): string[] {
  const d = asDoc(ud);
  if (!d) return [];
  const set = Object.keys(asDoc(d.updatedFields) ?? {});
  const removed = (Array.isArray(d.removedFields) ? d.removedFields : []).map(String);
  const truncated = (Array.isArray(d.truncatedArrays) ? d.truncatedArrays : []).map((t) => String(asDoc(t)?.field));
  return [...new Set([...set, ...removed, ...truncated])];
}

/** Latest known state per document (see `docKey`); bounded so a bulk insert can't grow it forever. */
export class KnownDocs {
  private map = new Map<string, Doc>();
  constructor(private readonly cap = 20_000) {}
  get(k: string) {
    return this.map.get(k);
  }
  set(k: string, d: Doc) {
    this.map.delete(k);
    this.map.set(k, d);
    if (this.map.size > this.cap) this.map.delete(this.map.keys().next().value!);
  }
  delete(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}

/** Builds a display event from a raw change event and records the document's new state in `known`. */
export function toChangeEvent(raw: Doc, seq: number, receivedAt: number, size: number, known: KnownDocs): ChangeEvent {
  const opType = typeof raw.operationType === "string" ? raw.operationType : "unknown";
  const op = opOf(opType);
  const ns = nsOf(raw);
  const id = asDoc(raw.documentKey)?._id;
  const idText = id === undefined ? null : JSON.stringify(id);
  const key = idText === null ? null : docKey(ns, idText);

  const pre = asDoc(raw.fullDocumentBeforeChange);
  const prev = key ? (known.get(key) ?? null) : null;
  const before = op === "insert" ? null : (pre ?? prev);
  const beforeSource: BeforeSource = op === "insert" ? "none" : pre ? "preImage" : prev ? "session" : "none";

  let after: Doc | null = null;
  let changed: string[] = [];
  if (op === "insert" || op === "replace") after = asDoc(raw.fullDocument);
  else if (op === "update") {
    changed = changedPaths(raw.updateDescription);
    after = before ? applyUpdateDescription(before, raw.updateDescription) : asDoc(raw.fullDocument);
  }
  if (op === "replace" && before && after) changed = diffDocs(before, after).map((c) => c.path);

  if (key) {
    if (op === "delete") known.delete(key);
    else if (after) known.set(key, after);
  }
  return { seq, time: eventTime(raw, receivedAt), op, opType, ns, idText, id, changed, before, after, beforeSource, raw, size };
}

/** Field-level changes of one event; for an update whose previous state is unknown, the set/removed
 *  fields with their new values only. */
export function eventChanges(e: ChangeEvent): DocChange[] {
  if (e.op === "insert" || e.op === "delete") return [];
  if (e.before && e.after) return diffDocs(e.before, e.after);
  if (e.op !== "update") return [];
  const ud = asDoc(e.raw.updateDescription) ?? {};
  const set = Object.entries(asDoc(ud.updatedFields) ?? {}).map(
    ([path, after]): DocChange => ({ path, kind: "changed", after }),
  );
  const removed = (Array.isArray(ud.removedFields) ? ud.removedFields : []).map(
    (path): DocChange => ({ path: String(path), kind: "removed" }),
  );
  return [...set, ...removed];
}

/** Short text for the event list's "changes" column. */
export function eventSummary(e: ChangeEvent): string {
  if (e.op === "update" || e.op === "replace") return e.changed.join(", ");
  if (e.op === "insert") return Object.keys(e.after ?? {}).filter((k) => k !== "_id").join(", ");
  if (e.op === "other") {
    const to = asDoc(e.raw.to);
    return to ? `→ ${to.db}.${to.coll}` : "";
  }
  return "";
}

export interface EventFilter {
  ops: ReadonlySet<ChangeOp>;
  /** Case-insensitive text matched against the _id, namespace and changed field paths. */
  text: string;
}

export function matchesFilter(e: ChangeEvent, f: EventFilter): boolean {
  if (!f.ops.has(e.op)) return false;
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  return (
    (e.idText ?? "").toLowerCase().includes(q) ||
    e.ns.toLowerCase().includes(q) ||
    e.opType.toLowerCase().includes(q) ||
    e.changed.some((p) => p.toLowerCase().includes(q))
  );
}

/** Drops the oldest events until both the count and the total serialized size fit. */
export function trimEvents<T extends { size: number }>(events: T[], maxCount: number, maxChars: number): T[] {
  let total = 0;
  let start = events.length;
  while (start > 0 && events.length - start < maxCount && total + events[start - 1].size <= maxChars) {
    start -= 1;
    total += events[start].size;
  }
  // Always keep the newest event, even when it alone exceeds the budget.
  if (start === events.length && events.length) start -= 1;
  return start === 0 ? events : events.slice(start);
}

/** `$match` stage restricting a stream to one document (for "watch this document"). */
export function documentPipeline(idText: string): string {
  return `[{"$match":{"documentKey._id":${idText}}}]`;
}

/** The recording as an Extended JSON array of the raw events, oldest first. */
export function exportEvents(events: readonly ChangeEvent[]): string {
  return `[\n${events.map((e) => JSON.stringify(e.raw)).join(",\n")}\n]\n`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** Local wall-clock time with milliseconds: "14:03:07.120". */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
