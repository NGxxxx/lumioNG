import type { SortKey } from "./grid";

/** A named way of looking at one collection: filter plus grid layout (column widths excluded). */
export interface ViewPreset {
  name: string;
  /** Canonical filter JSON, as applied. */
  filter: string;
  sort: SortKey[];
  hidden: string[];
  pinned: string[];
  mode: "grid" | "tree";
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isSortKey = (s: unknown): s is SortKey =>
  !!s && typeof s === "object" && typeof (s as SortKey).path === "string" && ((s as SortKey).dir === 1 || (s as SortKey).dir === -1);

/** The valid presets in `raw` (stored data may be stale or hand-edited); malformed entries are dropped. */
export function parsePresets(raw: unknown): ViewPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewPreset[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== "object") continue;
    const { name, filter, sort, hidden, pinned, mode } = e;
    if (typeof name !== "string" || !name.trim() || typeof filter !== "string") continue;
    if (!Array.isArray(sort) || !sort.every(isSortKey) || !strings(hidden) || !strings(pinned)) continue;
    if (mode !== "grid" && mode !== "tree") continue;
    out.push({ name, filter, sort, hidden, pinned, mode });
  }
  return out;
}

/** Adds the preset, replacing one with the same name (case-insensitive) in place; list stays name-sorted. */
export function upsertPreset(list: readonly ViewPreset[], p: ViewPreset): ViewPreset[] {
  const key = p.name.trim().toLowerCase();
  const rest = list.filter((x) => x.name.trim().toLowerCase() !== key);
  return [...rest, { ...p, name: p.name.trim() }].sort((a, b) => a.name.localeCompare(b.name));
}
