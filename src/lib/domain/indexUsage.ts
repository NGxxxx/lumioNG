/** Classify index usage ($indexStats), detect redundant indexes, and order rows for the Indexes table. */
import { numFromExt, dateIsoFromExt } from "./extjson";
import type { IndexInfo } from "./indexes";

const DAY_MS = 86_400_000;

/** Below this many days of usage data, conclusions are low-confidence (no "suggested" badge). */
export const LOW_CONFIDENCE_DAYS = 7;

export type IndexUsage = { name: string; ops: number; since: number /* ms */ };

export type IndexStatus =
  | "inUse"
  | "rare"
  | "unused"
  | "hidden"
  | "protectedId"
  | "protectedUnique"
  | "protectedTtl"
  | "protectedShardKey";

export type IndexRow = {
  info: IndexInfo;
  usage: IndexUsage | null;
  size: number | null;
  status: IndexStatus;
  redundantWith: string | null;
};

function sinceMs(v: unknown): number {
  const iso = dateIsoFromExt(v);
  if (iso === null) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Parse `$indexStats` entries (ExtJSON text). Entries with the same name (one per shard) are
 * merged: ops are summed, `since` is the latest. Order follows first appearance.
 */
export function parseIndexStats(texts: string[]): IndexUsage[] {
  const byName = new Map<string, IndexUsage>();
  for (const t of texts) {
    const doc = JSON.parse(t) as Record<string, unknown>;
    const name = String(doc.name ?? "");
    const acc = (doc.accesses ?? {}) as Record<string, unknown>;
    const ops = numFromExt(acc.ops) ?? 0;
    const since = sinceMs(acc.since);
    const prev = byName.get(name);
    if (prev) {
      prev.ops += ops;
      prev.since = Math.max(prev.since, since);
    } else {
      byName.set(name, { name, ops, since });
    }
  }
  return [...byName.values()];
}

function isShardKeyPrefix(idx: IndexInfo, shardKey: string[] | null | undefined): boolean {
  if (!shardKey || shardKey.length === 0 || shardKey.length > idx.entries.length) return false;
  return shardKey.every((f, i) => idx.entries[i].field === f);
}

/**
 * Status of one index. Order of precedence: `_id_`, hidden, then the other protections
 * (unique, TTL, shard-key prefix), then usage. Without usage data the index is "inUse"
 * (never suggested). Rare = < 1 op/day since `since` and larger than the mean index size.
 */
export function classify(
  idx: IndexInfo,
  usage: IndexUsage | null,
  sizeBytes: number | null,
  meanSize: number,
  now: number,
  shardKey?: string[] | null,
): IndexStatus {
  if (idx.isId) return "protectedId";
  if (idx.hidden) return "hidden";
  if (idx.unique) return "protectedUnique";
  if (idx.ttl !== null) return "protectedTtl";
  if (isShardKeyPrefix(idx, shardKey)) return "protectedShardKey";
  if (usage === null) return "inUse";
  if (usage.ops === 0) return "unused";
  const days = Math.max(1, (now - usage.since) / DAY_MS);
  if (usage.ops / days < 1 && sizeBytes !== null && sizeBytes > meanSize) return "rare";
  return "inUse";
}

function excludedFromRedundancy(i: IndexInfo): boolean {
  return i.isId || i.unique || i.partial || i.sparse || i.ttl !== null;
}

/**
 * Name of the first index (list order) whose key pattern strictly extends `idx`'s with the same
 * fields and directions and the same collation; null if none. Unique / partial / sparse / TTL /
 * `_id_` indexes are never compared (on either side), and a hidden index never covers another.
 */
export function redundantWith(idx: IndexInfo, all: IndexInfo[]): string | null {
  if (excludedFromRedundancy(idx)) return null;
  const n = idx.entries.length;
  for (const other of all) {
    if (other === idx || other.name === idx.name) continue;
    if (excludedFromRedundancy(other)) continue;
    if (other.hidden) continue; // the planner ignores a hidden index: it covers nothing
    if (other.entries.length <= n) continue;
    if (other.collation !== idx.collation) continue;
    const prefix = idx.entries.every(
      (e, i) => other.entries[i].field === e.field && other.entries[i].value === e.value,
    );
    if (prefix) return other.name;
  }
  return null;
}

/** Whole days of usage data (from the latest `since`); null when there is no usage data. */
export function dataDays(usage: IndexUsage[], now: number): number | null {
  if (usage.length === 0) return null;
  const latest = Math.max(...usage.map((u) => u.since));
  return Math.max(0, Math.floor((now - latest) / DAY_MS));
}

const STATUS_RANK: Partial<Record<IndexStatus, number>> = { unused: 0, rare: 1 };

/** Join index info, usage and sizes into table rows: unused first, then rare, then by size desc. */
export function buildIndexRows(
  infos: IndexInfo[],
  usage: IndexUsage[],
  sizes: Record<string, number>,
  now: number,
  shardKey?: string[] | null,
): IndexRow[] {
  const usageByName = new Map(usage.map((u) => [u.name, u]));
  const known = infos.map((i) => sizes[i.name]).filter((s): s is number => typeof s === "number");
  const meanSize = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const rows = infos.map((info): IndexRow => {
    const u = usageByName.get(info.name) ?? null;
    const size = typeof sizes[info.name] === "number" ? sizes[info.name] : null;
    return {
      info,
      usage: u,
      size,
      status: classify(info, u, size, meanSize, now, shardKey),
      redundantWith: redundantWith(info, infos),
    };
  });
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ra = STATUS_RANK[a.r.status] ?? 2;
      const rb = STATUS_RANK[b.r.status] ?? 2;
      if (ra !== rb) return ra - rb;
      const sa = a.r.size ?? -1;
      const sb = b.r.size ?? -1;
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map(({ r }) => r);
}

/** Count and total size of the "unused" rows. */
export function unusedSummary(rows: IndexRow[]): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const r of rows) {
    if (r.status !== "unused") continue;
    count++;
    bytes += r.size ?? 0;
  }
  return { count, bytes };
}

export type ServerTraits = {
  /** Hidden indexes need MongoDB 4.4+ (wire version 9). */
  canHide: boolean;
  topology: "replica" | "sharded" | null;
  /** The member whose counters `$indexStats` reports (replica sets count on this node only). */
  host: string | null;
};

/** From a `hello` / `isMaster` reply (canonical ExtJSON). Unknown → hiding allowed, no topology note. */
export function parseServerTraits(text: string | null): ServerTraits {
  if (!text) return { canHide: true, topology: null, host: null };
  try {
    const d = JSON.parse(text) as Record<string, unknown>;
    const wire = numFromExt(d.maxWireVersion);
    const topology = d.msg === "isdbgrid" ? "sharded" : typeof d.setName === "string" ? "replica" : null;
    return { canHide: wire === null || wire >= 9, topology, host: typeof d.me === "string" ? d.me : null };
  } catch {
    return { canHide: true, topology: null, host: null };
  }
}

/** Shard key fields from a `config.collections` document; null when absent/unreadable. */
export function parseShardKey(text: string | null): string[] | null {
  if (!text) return null;
  try {
    const key = (JSON.parse(text) as { key?: unknown }).key;
    return key && typeof key === "object" && !Array.isArray(key) ? Object.keys(key) : null;
  } catch {
    return null;
  }
}
