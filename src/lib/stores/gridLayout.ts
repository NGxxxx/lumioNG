// src/lib/stores/gridLayout.ts — the Data grid's layout per connection/db/collection (hidden and
// pinned columns, widths, sort, Grid/Tree), kept in local storage (spec §2.4). Tolerant of bad data.
import type { SortKey } from "../domain/grid";
import { prefs } from "./prefs.svelte";

export const LAYOUT_KEY = "lumio.gridLayout.v1";

export type GridLayout = {
  hidden: string[];
  pinned: string[];
  widths: Record<string, number>;
  sort: SortKey[];
  mode: "grid" | "tree";
};

function readAll(): Record<string, unknown> {
  try {
    const raw = JSON.parse(prefs.getItem(LAYOUT_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, unknown>) {
  try {
    prefs.setItem(LAYOUT_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: layout just isn't remembered
  }
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** The saved layout, with any malformed parts dropped; null when nothing usable is stored. */
export function loadLayout(ns: string): GridLayout | null {
  const e = readAll()[ns] as Record<string, unknown> | undefined;
  if (!e || typeof e !== "object" || !strings(e.hidden) || !strings(e.pinned) || (e.mode !== "grid" && e.mode !== "tree")) return null;
  const widths: Record<string, number> = {};
  if (e.widths && typeof e.widths === "object") {
    for (const [k, v] of Object.entries(e.widths as Record<string, unknown>)) if (typeof v === "number" && v > 0) widths[k] = v;
  }
  const sort = Array.isArray(e.sort)
    ? (e.sort as unknown[]).filter((s): s is SortKey => !!s && typeof s === "object" && typeof (s as SortKey).path === "string" && ((s as SortKey).dir === 1 || (s as SortKey).dir === -1))
    : [];
  return { hidden: e.hidden, pinned: e.pinned, widths, sort, mode: e.mode };
}

export function saveLayout(ns: string, l: GridLayout) {
  writeAll({ ...readAll(), [ns]: l });
}

export function clearLayout(ns: string) {
  const all = readAll();
  delete all[ns];
  writeAll(all);
}
