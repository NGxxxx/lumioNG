/** Database profiler entries (`system.profile`): display rows, speed and index hints, filtering,
 *  and the mongosh statement to re-run one. */
import type { Doc } from "./doc";
import { numFromExt, dateIsoFromExt } from "./extjson";

export type QueryKind = "read" | "write" | "other";
export const QUERY_KINDS: readonly QueryKind[] = ["read", "write", "other"];

export type Speed = "fast" | "medium" | "slow";
/** Below FAST_MS a query reads as fast; from SLOW_MS on as slow. */
export const FAST_MS = 100;
export const SLOW_MS = 1000;

export interface QueryEntry {
  seq: number;
  time: number;
  /** The command name: find, aggregate, update, delete, insert, count, getMore… */
  name: string;
  kind: QueryKind;
  ns: string;
  coll: string;
  millis: number;
  /** planSummary, e.g. "IXSCAN { status: 1 }" or "COLLSCAN"; empty when the server gives none. */
  plan: string;
  collscan: boolean;
  docsExamined: number | null;
  keysExamined: number | null;
  returned: number | null;
  /** Documents inserted / modified / deleted, for writes. */
  affected: number | null;
  /** The command as sent, without driver plumbing. */
  command: Doc;
  appName: string;
  client: string;
  raw: Doc;
  size: number;
}

const asDoc = (v: unknown): Doc | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : null);
const num = (v: unknown): number | null => numFromExt(v);

const READS = new Set(["find", "aggregate", "count", "distinct", "getMore", "explain", "mapReduce"]);
const WRITES = new Set(["insert", "update", "delete", "findAndModify", "bulkWrite"]);

/** Fields drivers add to every command that say nothing about the query itself. */
const PLUMBING = new Set(["lsid", "$clusterTime", "$db", "$readPreference", "txnNumber", "autocommit", "startTransaction", "apiVersion", "$audit", "signature"]);

function cleanCommand(c: Doc): Doc {
  return Object.fromEntries(Object.entries(c).filter(([k]) => !PLUMBING.has(k)));
}

/** Command name: the profile's `op` for writes (their entry holds a single statement), else the
 *  command document's first key. */
function nameOf(op: string, command: Doc): string {
  if (op === "update") return "update";
  if (op === "remove") return "delete";
  if (op === "insert") return "insert";
  if (op === "getmore") return "getMore";
  return Object.keys(command)[0] ?? op;
}

export function toQueryEntry(raw: Doc, seq: number, receivedAt: number, size: number): QueryEntry {
  const op = typeof raw.op === "string" ? raw.op : "command";
  const command = cleanCommand(asDoc(raw.command) ?? {});
  const name = nameOf(op, command);
  const ns = typeof raw.ns === "string" ? raw.ns : "";
  const dot = ns.indexOf(".");
  const plan = typeof raw.planSummary === "string" ? raw.planSummary : "";
  const iso = dateIsoFromExt(raw.ts);
  const ts = iso ? Date.parse(iso) : NaN;
  const affected = num(raw.ninserted) ?? num(raw.nModified) ?? num(raw.ndeleted);
  return {
    seq,
    time: Number.isNaN(ts) ? receivedAt : ts,
    name,
    kind: READS.has(name) ? "read" : WRITES.has(name) ? "write" : "other",
    ns,
    coll: dot >= 0 ? ns.slice(dot + 1) : ns,
    millis: num(raw.millis) ?? 0,
    plan,
    collscan: plan.startsWith("COLLSCAN"),
    docsExamined: num(raw.docsExamined),
    keysExamined: num(raw.keysExamined),
    returned: num(raw.nreturned),
    affected,
    command,
    appName: typeof raw.appName === "string" ? raw.appName : "",
    client: typeof raw.client === "string" ? raw.client : "",
    raw,
    size,
  };
}

export function speedOf(millis: number): Speed {
  return millis >= SLOW_MS ? "slow" : millis >= FAST_MS ? "medium" : "fast";
}

/** "1.2 s" / "340 ms" / "0 ms". */
export function formatMillis(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : `${Math.round(ms)} ms`;
}

/** A query that read far more than it returned, or scanned the whole collection: a missing index. */
export type IndexHint = { kind: "collscan" } | { kind: "ratio"; examined: number; returned: number } | null;

/** Reads below this many examined documents are too small to matter. */
const HINT_MIN_EXAMINED = 1000;
const HINT_RATIO = 100;

export function indexHint(e: QueryEntry): IndexHint {
  const examined = e.docsExamined ?? 0;
  if (examined < HINT_MIN_EXAMINED) return null;
  if (e.collscan) return { kind: "collscan" };
  const out = e.kind === "write" ? (e.affected ?? 0) : (e.returned ?? 0);
  return examined >= HINT_RATIO * Math.max(out, 1) ? { kind: "ratio", examined, returned: out } : null;
}

const compact = (v: unknown, max = 160) => {
  const s = JSON.stringify(v) ?? "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

/** One-line description of what the query asked for. */
export function querySummary(e: QueryEntry): string {
  const c = e.command;
  switch (e.name) {
    case "find":
      return compact(c.filter ?? {});
    case "aggregate":
      return Array.isArray(c.pipeline) ? c.pipeline.map((s) => Object.keys(asDoc(s) ?? {})[0] ?? "?").join(" → ") : "";
    case "count":
      return compact(c.query ?? {});
    case "distinct":
      return `${String(c.key ?? "")} ${compact(c.query ?? {})}`;
    case "update":
    case "delete":
      return compact(c.q ?? {});
    case "findAndModify":
      return compact(c.query ?? {});
    case "insert":
      return e.affected !== null ? `${e.affected}` : "";
    case "getMore": {
      const orig = asDoc(e.raw.originatingCommand);
      return orig ? Object.keys(orig)[0] ?? "" : "";
    }
    default:
      return compact(c);
  }
}

export interface QueryFilter {
  kinds: ReadonlySet<QueryKind>;
  /** Only queries that look like they lack an index. */
  needsIndex: boolean;
  text: string;
}

export function matchesQueryFilter(e: QueryEntry, f: QueryFilter): boolean {
  if (!f.kinds.has(e.kind)) return false;
  if (f.needsIndex && !indexHint(e)) return false;
  const q = f.text.trim().toLowerCase();
  if (!q) return true;
  return (
    e.ns.toLowerCase().includes(q) ||
    e.name.toLowerCase().includes(q) ||
    e.plan.toLowerCase().includes(q) ||
    e.appName.toLowerCase().includes(q) ||
    querySummary(e).toLowerCase().includes(q)
  );
}

const j = (v: unknown) => JSON.stringify(v);

/** A mongosh statement that runs the same query again (for the Query tab), or null when the entry
 *  isn't something worth re-running (getMore, killCursors…). */
export function queryStatement(e: QueryEntry): string | null {
  const c = e.command;
  const coll = `db.getCollection(${j(e.coll)})`;
  switch (e.name) {
    case "find": {
      let s = `${coll}.find(${j(c.filter ?? {})}${c.projection ? `, ${j(c.projection)}` : ""})`;
      if (c.sort) s += `.sort(${j(c.sort)})`;
      const skip = num(c.skip);
      const limit = num(c.limit);
      if (skip) s += `.skip(${skip})`;
      if (limit) s += `.limit(${limit})`;
      return s;
    }
    case "aggregate":
      return `${coll}.aggregate(${j(c.pipeline ?? [])})`;
    case "count":
      return `${coll}.countDocuments(${j(c.query ?? {})})`;
    case "distinct":
      return `${coll}.distinct(${j(c.key ?? "")}, ${j(c.query ?? {})})`;
    case "update":
      return `${coll}.${c.multi === true ? "updateMany" : "updateOne"}(${j(c.q ?? {})}, ${j(c.u ?? {})})`;
    case "delete":
      return `${coll}.${num(c.limit) === 1 ? "deleteOne" : "deleteMany"}(${j(c.q ?? {})})`;
    case "getMore":
    case "killCursors":
    case "insert":
      return null;
    default:
      return `db.runCommand(${j(c)})`;
  }
}
