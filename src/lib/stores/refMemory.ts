// src/lib/stores/refMemory.ts — remembered "this field points at that collection" choices for the
// ObjectId reference jump (prefs store, capped; corrupt data is ignored).
import { prefs } from "./prefs.svelte";

const KEY = "lumio.refTargets.v1";
export const REF_MEMORY_CAP = 500;

type Entry = { coll: string; at: number };

function read(): Record<string, Entry> {
  try {
    const v = JSON.parse(prefs.getItem(KEY) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, Entry> = {};
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const en = e as Partial<Entry> | null;
      if (en && typeof en.coll === "string" && typeof en.at === "number") out[k] = { coll: en.coll, at: en.at };
    }
    return out;
  } catch {
    return {};
  }
}

function write(all: Record<string, Entry>) {
  try {
    prefs.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: nothing is remembered */
  }
}

export function getRemembered(key: string): string | null {
  return read()[key]?.coll ?? null;
}

export function remember(key: string, coll: string, now: number = Date.now()) {
  const all = read();
  all[key] = { coll, at: now };
  const keys = Object.keys(all);
  if (keys.length > REF_MEMORY_CAP) {
    keys.sort((a, b) => all[a].at - all[b].at);
    for (const k of keys.slice(0, keys.length - REF_MEMORY_CAP)) delete all[k];
  }
  write(all);
}

export function forget(key: string) {
  const all = read();
  delete all[key];
  write(all);
}

// ---- Relationship-diagram decisions: edges the user confirmed or removed, per connection + database.
const EDGE_KEY = "lumio.refEdges.v1";
export type EdgeDecision = "confirmed" | "removed";
type EdgeEntry = { state: EdgeDecision; at: number };

/** Key of one diagram edge (`edgeId` is `from.path->to`). */
export function edgeKey(connId: number | null, db: string, edgeId: string): string {
  return `${connId ?? "-"}|${db}|${edgeId}`;
}

function readEdges(): Record<string, EdgeEntry> {
  try {
    const v = JSON.parse(prefs.getItem(EDGE_KEY) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, EdgeEntry> = {};
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const en = e as Partial<EdgeEntry> | null;
      if (en && (en.state === "confirmed" || en.state === "removed") && typeof en.at === "number") out[k] = { state: en.state, at: en.at };
    }
    return out;
  } catch {
    return {};
  }
}

/** All decisions of one connection + database, keyed by edge id. */
export function getEdgeDecisions(connId: number | null, db: string): Record<string, EdgeDecision> {
  const prefix = `${connId ?? "-"}|${db}|`;
  const out: Record<string, EdgeDecision> = {};
  for (const [k, e] of Object.entries(readEdges())) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = e.state;
  return out;
}

export function setEdgeDecision(key: string, state: EdgeDecision, now: number = Date.now()) {
  const all = readEdges();
  all[key] = { state, at: now };
  const keys = Object.keys(all);
  if (keys.length > REF_MEMORY_CAP) {
    keys.sort((a, b) => all[a].at - all[b].at);
    for (const k of keys.slice(0, keys.length - REF_MEMORY_CAP)) delete all[k];
  }
  try {
    prefs.setItem(EDGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function clearEdgeDecision(key: string) {
  const all = readEdges();
  delete all[key];
  try {
    prefs.setItem(EDGE_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}
