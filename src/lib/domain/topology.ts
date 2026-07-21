/** Parse isMaster/replSetGetStatus/listShards/balancerStatus into curated shapes for the Topology sub-tab. */
import { numFromExt } from "./extjson";

export type TopologyKind = "standalone" | "replicaSet" | "mongos";

export interface ReplMember {
  name: string;
  stateStr: string;
  health: number | null;
  uptime: number | null;
  optimeDate: string | null;
  pingMs: number | null;
  self: boolean;
}

export interface ShardInfo {
  id: string;
  host: string;
  draining: boolean;
}

export interface BalancerInfo {
  mode: string | null;
  inBalancerRound: boolean | null;
}

export type TopologyInfo =
  | { kind: "standalone" }
  | { kind: "replicaSet"; setName: string; members: ReplMember[] }
  | { kind: "mongos"; shards: ShardInfo[]; balancer: BalancerInfo | null };

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

/** `setName` present ⇒ replica set member; `msg === "isdbgrid"` ⇒ mongos router; neither ⇒ standalone. */
export function detectTopologyKind(isMasterJson: string): TopologyKind {
  const doc = JSON.parse(isMasterJson) as Record<string, unknown>;
  if (typeof doc.setName === "string") return "replicaSet";
  if (doc.msg === "isdbgrid") return "mongos";
  return "standalone";
}

/** Curate a `replSetGetStatus` response into the set name and member rows. */
export function parseReplSetStatus(json: string): { setName: string; members: ReplMember[] } {
  const doc = JSON.parse(json) as Record<string, unknown>;
  const members = Array.isArray(doc.members) ? (doc.members as Record<string, unknown>[]) : [];
  return {
    setName: str(doc.set) ?? "",
    members: members.map((mem) => ({
      name: str(mem.name) ?? "",
      stateStr: str(mem.stateStr) ?? "",
      health: numFromExt(mem.health),
      uptime: numFromExt(mem.uptime),
      optimeDate: dateIso(mem.optimeDate),
      pingMs: numFromExt(mem.pingMs),
      self: mem.self === true,
    })),
  };
}

/** Curate a `listShards` response into shard rows. */
export function parseShardList(json: string): ShardInfo[] {
  const doc = JSON.parse(json) as Record<string, unknown>;
  const shards = Array.isArray(doc.shards) ? (doc.shards as Record<string, unknown>[]) : [];
  return shards.map((s) => ({
    id: str(s._id) ?? "",
    host: str(s.host) ?? "",
    draining: s.draining === true,
  }));
}

/** Curate a `balancerStatus` response. */
export function parseBalancerStatus(json: string): BalancerInfo {
  const doc = JSON.parse(json) as Record<string, unknown>;
  return {
    mode: str(doc.mode),
    inBalancerRound: typeof doc.inBalancerRound === "boolean" ? doc.inBalancerRound : null,
  };
}
