/** Parse serverStatus/buildInfo/hostInfo into a curated HostInfo structure for the Host tab. */
import { numFromExt } from "./extjson";

export interface HostInfo {
  version: string | null;
  storageEngine: string | null;
  uptimeSeconds: number | null;
  localTimeIso: string | null;
  connectionsCurrent: number | null;
  connectionsAvailable: number | null;
  memResidentMb: number | null;
  memVirtualMb: number | null;
  opcounters: Record<string, number | null>;
  network: { bytesIn: number | null; bytesOut: number | null; numRequests: number | null };
  hostname: string | null;
  os: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Resolve an ExtJSON $date (string or { $date: { $numberLong } }) to an ISO string. */
function dateIso(v: unknown): string | null {
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

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Curate serverStatus (+ buildInfo, optional hostInfo) into the Host tab's metrics; `serverStatusJson` is null when the connection lacks privilege, and the tab still renders buildInfo-derived fields. */
export function parseHostInfo(
  serverStatusJson: string | null,
  buildInfoJson: string,
  hostInfoJson: string | null,
): HostInfo {
  const ss = serverStatusJson ? (JSON.parse(serverStatusJson) as Record<string, unknown>) : {};
  const bi = JSON.parse(buildInfoJson) as Record<string, unknown>;
  const hi = hostInfoJson ? (JSON.parse(hostInfoJson) as Record<string, unknown>) : {};

  const conn = obj(ss.connections);
  const mem = obj(ss.mem);
  const net = obj(ss.network);
  const storage = obj(ss.storageEngine);
  const system = obj(hi.system);
  const osObj = obj(hi.os);

  const opcounters = Object.fromEntries(
    Object.entries(obj(ss.opcounters)).map(([k, v]) => [k, numFromExt(v)]),
  );

  const osName = str(osObj.name);
  const osVer = str(osObj.version);

  return {
    version: str(ss.version) ?? str(bi.version),
    storageEngine: str(storage.name),
    uptimeSeconds: numFromExt(ss.uptime),
    localTimeIso: dateIso(ss.localTime),
    connectionsCurrent: numFromExt(conn.current),
    connectionsAvailable: numFromExt(conn.available),
    memResidentMb: numFromExt(mem.resident),
    memVirtualMb: numFromExt(mem.virtual),
    opcounters,
    network: {
      bytesIn: numFromExt(net.bytesIn),
      bytesOut: numFromExt(net.bytesOut),
      numRequests: numFromExt(net.numRequests),
    },
    hostname: str(system.hostname),
    os: osName || osVer ? `${osName ?? ""} ${osVer ?? ""}`.trim() : null,
  };
}

/** Must match the driver's default `app_name` in `src-tauri/src/commands/connection.rs::open_client` — used to tell monglumio's own ops apart from other clients (mongosh, Compass…) in the Current Operations panel. */
export const OWN_APP_NAME = "LumioNG";

export interface OpInfo {
  opid: number;
  secsRunning: number | null;
  op: string | null;
  ns: string | null;
  client: string | null;
  desc: string | null;
  appName: string | null;
}

/** Curate a `currentOp` response into a list sorted by longest-running first. */
export function parseCurrentOps(json: string): OpInfo[] {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const inprog = Array.isArray(parsed.inprog) ? (parsed.inprog as Record<string, unknown>[]) : [];
  const ops: OpInfo[] = [];
  for (const o of inprog) {
    const opid = numFromExt(o.opid);
    if (opid === null) continue; // sharded-cluster opids ("shard:12345") are strings, not supported in v1
    ops.push({
      opid,
      secsRunning: numFromExt(o.secs_running),
      op: str(o.op),
      ns: str(o.ns),
      client: str(o.client),
      desc: str(o.desc),
      appName: str(o.appName),
    });
  }
  return ops.sort((a, b) => (b.secsRunning ?? 0) - (a.secsRunning ?? 0));
}

export interface StartupLogEntry {
  hostname: string | null;
  startTimeIso: string | null;
  pid: number | null;
  version: string | null;
  cmdLineText: string | null;
}

/** Curate `local.startup_log` documents (one per mongod restart) into a restart history for the
 *  Host tab — `cmdLine`'s exact shape varies across MongoDB versions, so it's kept as raw JSON text. */
export function parseStartupLog(rawDocs: string[]): StartupLogEntry[] {
  return rawDocs.map((raw) => {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const bi = obj(d.buildinfo);
    return {
      hostname: str(d.hostname),
      startTimeIso: dateIso(d.startTime),
      pid: numFromExt(d.pid),
      version: str(bi.version),
      cmdLineText: d.cmdLine !== undefined ? JSON.stringify(d.cmdLine) : null,
    };
  });
}

/** Format an uptime in seconds as "1d 2h 3m" (drops leading zero units, always shows minutes). */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const s = Math.floor(seconds);
  if (s < 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
