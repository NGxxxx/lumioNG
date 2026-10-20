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
