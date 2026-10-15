/** Server metric sampling for the Overview dashboard: parse `server_metrics` samples, derive per-second rates, keep capped sparkline series, parse slow running ops. */
import { numFromExt } from "./extjson";

export type OpKind = "insert" | "query" | "update" | "delete" | "getmore" | "command";

const OP_KINDS: OpKind[] = ["insert", "query", "update", "delete", "getmore", "command"];

export type Sample = {
  at: number;
  uptime: number;
  opcounters: Record<OpKind, number>;
  connCurrent: number;
  connAvailable: number;
  netIn: number;
  netOut: number;
  memResidentMb: number | null;
  host: string | null;
  version: string | null;
};

export type Rates = { ops: number; byKind: Record<OpKind, number>; netInPerSec: number; netOutPerSec: number };

export type Point = { at: number; v: number } | null;

/** `opid` is a number on mongod and a `"shard:1234"` string on mongos. */
export type SlowOp = { opid: number | string; op: string; ns: string; secs: number; client: string; appName: string };

type Obj = Record<string, unknown>;

function parseObj(text: string): Obj | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
  } catch {
    return null;
  }
}

function sub(o: Obj, k: string): Obj {
  const v = o[k];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Parse one `server_metrics` ExtJSON text; null when unparseable or without `uptime`. Missing counters read as 0. */
export function parseSample(text: string, at: number): Sample | null {
  const o = parseObj(text);
  if (!o) return null;
  const uptime = numFromExt(o.uptime);
  if (uptime === null) return null;
  const oc = sub(o, "opcounters");
  const conn = sub(o, "connections");
  const net = sub(o, "network");
  const opcounters = {} as Record<OpKind, number>;
  for (const k of OP_KINDS) opcounters[k] = numFromExt(oc[k]) ?? 0;
  return {
    at,
    uptime,
    opcounters,
    connCurrent: numFromExt(conn.current) ?? 0,
    connAvailable: numFromExt(conn.available) ?? 0,
    netIn: numFromExt(net.bytesIn) ?? 0,
    netOut: numFromExt(net.bytesOut) ?? 0,
    memResidentMb: numFromExt(sub(o, "mem").resident),
    host: str(o.host),
    version: str(o.version),
  };
}

/** Per-second deltas between two samples; null (a gap) on restart/reset (uptime dropped or any counter decreased) or `dt <= 0`. */
export function rates(prev: Sample, next: Sample): Rates | null {
  const dt = (next.at - prev.at) / 1000;
  if (dt <= 0) return null;
  if (next.uptime < prev.uptime) return null;
  if (next.netIn < prev.netIn || next.netOut < prev.netOut) return null;
  const byKind = {} as Record<OpKind, number>;
  let ops = 0;
  for (const k of OP_KINDS) {
    const d = next.opcounters[k] - prev.opcounters[k];
    if (d < 0) return null;
    byKind[k] = d / dt;
    ops += byKind[k];
  }
  return {
    ops,
    byKind,
    netInPerSec: (next.netIn - prev.netIn) / dt,
    netOutPerSec: (next.netOut - prev.netOut) / dt,
  };
}

/** Immutable append keeping the last `cap` points; `null` is a gap. */
export function pushPoint(series: Point[], p: Point, cap = 60): Point[] {
  const out = [...series, p];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** Delay before the next poll: a slow server stretches the interval. */
export function nextDelay(intervalMs: number, lastTickMs: number): number {
  return Math.max(intervalMs, Math.round(1.5 * lastTickMs));
}

/** Parse currentOp entry texts; drops unparseable entries, entries without an opid and the app's own ops; longest-running first. */
export function parseSlowOps(texts: string[], ownApp: string): SlowOp[] {
  const ops: SlowOp[] = [];
  for (const t of texts) {
    const o = parseObj(t);
    if (!o) continue;
    const opid = typeof o.opid === "string" && o.opid ? o.opid : numFromExt(o.opid);
    if (opid === null) continue;
    const appName = str(o.appName) ?? "";
    if (appName === ownApp) continue;
    ops.push({
      opid,
      op: str(o.op) ?? "",
      ns: str(o.ns) ?? "",
      secs: numFromExt(o.secs_running) ?? 0,
      client: str(o.client) ?? str(o.client_s) ?? "",
      appName,
    });
  }
  return ops.sort((a, b) => b.secs - a.secs);
}

export type ProfileEntry = { ts: number; op: string; ns: string; millis: number; plan: string };

/** One `system.profile` document (canonical ExtJSON) → what the Overview lists; null when unreadable. */
export function parseProfileEntry(text: string): ProfileEntry | null {
  let d: Record<string, unknown>;
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    d = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawTs = (d.ts as { $date?: unknown } | undefined)?.$date;
  const ts = typeof rawTs === "string" ? Date.parse(rawTs) : (numFromExt(rawTs) ?? NaN);
  return {
    ts: Number.isFinite(ts) ? ts : 0,
    op: typeof d.op === "string" ? d.op : "",
    ns: typeof d.ns === "string" ? d.ns : "",
    millis: numFromExt(d.millis) ?? 0,
    plan: typeof d.planSummary === "string" ? d.planSummary : "",
  };
}
