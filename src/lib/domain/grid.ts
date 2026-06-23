/** Sort-key and projection helpers for the data grid (sort cycling, build, projection). */

/** A sort key: dot-path + direction (1 asc / -1 desc). */
export interface SortKey {
  path: string;
  dir: 1 | -1;
}

/**
 * Cycle the sort on a header click.
 * - shift = false: single-key mode, cycles none→asc→desc→none for this field.
 * - shift = true: multi-key mode, appends a new field (asc) or cycles an existing one
 *   (asc→desc→remove), leaving other keys untouched.
 */
export function cycleSort(keys: SortKey[], path: string, shift: boolean): SortKey[] {
  if (!shift) {
    const only = keys.length === 1 && keys[0].path === path ? keys[0] : null;
    if (only?.dir === 1) return [{ path, dir: -1 }];
    if (only?.dir === -1) return [];
    return [{ path, dir: 1 }];
  }
  const idx = keys.findIndex((k) => k.path === path);
  if (idx === -1) return [...keys, { path, dir: 1 }];
  if (keys[idx].dir === 1) {
    const next = [...keys];
    next[idx] = { path, dir: -1 };
    return next;
  }
  return keys.filter((k) => k.path !== path);
}

/** Append an asc sort key for path if not already present; no-op if already in the list. */
export function addSortKey(keys: SortKey[], path: string): SortKey[] {
  if (keys.some((k) => k.path === path)) return keys;
  return [...keys, { path, dir: 1 }];
}

/** Toggle direction of a key (1↔-1); no-op when path is not in the list. */
export function toggleSortDir(keys: SortKey[], path: string): SortKey[] {
  return keys.map((k) =>
    k.path === path ? { path: k.path, dir: (k.dir === 1 ? -1 : 1) as 1 | -1 } : k,
  );
}

/** Remove the key for path; no-op when path is not in the list. */
export function removeSortKey(keys: SortKey[], path: string): SortKey[] {
  return keys.filter((k) => k.path !== path);
}

/** Move a key by delta (±1) in the array, clamped to bounds; no-op when missing or already at an edge. */
export function moveSortKey(keys: SortKey[], path: string, delta: number): SortKey[] {
  const i = keys.findIndex((k) => k.path === path);
  if (i === -1) return keys;
  const j = i + delta;
  if (j < 0 || j >= keys.length) return keys;
  const next = [...keys];
  const [item] = next.splice(i, 1);
  next.splice(j, 0, item);
  return next;
}

/** Build a sort ExtJSON doc in priority order; appends {_id:1} as tie-breaker when absent. Empty → null. */
export function buildSort(keys: SortKey[]): string | null {
  if (keys.length === 0) return null;
  const obj: Record<string, number> = {};
  for (const k of keys) obj[k.path] = k.dir;
  if (!("_id" in obj)) obj._id = 1;
  return JSON.stringify(obj);
}

/** Build an exclusion projection ExtJSON from a set of hidden paths (skips _id). Empty → null. */
export function buildProjection(hidden: Set<string>): string | null {
  const obj: Record<string, number> = {};
  for (const p of hidden) if (p !== "_id") obj[p] = 0;
  return Object.keys(obj).length === 0 ? null : JSON.stringify(obj);
}
