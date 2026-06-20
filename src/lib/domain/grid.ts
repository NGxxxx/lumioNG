/** Một khóa sort: dot-path + chiều (1 asc / -1 desc). */
export interface SortKey {
  path: string;
  dir: 1 | -1;
}

/**
 * Xoay vòng sort khi click header.
 * - shift = false: chỉ giữ 1 khóa của field này, xoay none→asc→desc→none.
 * - shift = true: thêm field mới (append asc) hoặc xoay dir field đã có (asc→desc→bỏ),
 *   giữ nguyên thứ tự + chiều các khóa khác.
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

/** Thêm khóa sort asc cho path nếu chưa có; path đã có → giữ nguyên mảng. */
export function addSortKey(keys: SortKey[], path: string): SortKey[] {
  if (keys.some((k) => k.path === path)) return keys;
  return [...keys, { path, dir: 1 }];
}

/** Đảo chiều khóa của path (1↔-1); path không có → giữ nguyên. */
export function toggleSortDir(keys: SortKey[], path: string): SortKey[] {
  return keys.map((k) =>
    k.path === path ? { path: k.path, dir: (k.dir === 1 ? -1 : 1) as 1 | -1 } : k,
  );
}

/** Bỏ khóa của path; path không có → giữ nguyên. */
export function removeSortKey(keys: SortKey[], path: string): SortKey[] {
  return keys.filter((k) => k.path !== path);
}

/** Dời khóa path đi delta (±1) trong mảng, kẹp biên; không có/đụng biên → giữ nguyên. */
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

/** Sort doc ExtJSON giữ thứ tự ưu tiên; tự nối {_id:1} nếu chưa có khóa _id. Rỗng → null. */
export function buildSort(keys: SortKey[]): string | null {
  if (keys.length === 0) return null;
  const obj: Record<string, number> = {};
  for (const k of keys) obj[k.path] = k.dir;
  if (!("_id" in obj)) obj._id = 1;
  return JSON.stringify(obj);
}

/** Projection exclusion ExtJSON từ tập path ẩn (bỏ qua _id). Rỗng → null. */
export function buildProjection(hidden: Set<string>): string | null {
  const obj: Record<string, number> = {};
  for (const p of hidden) if (p !== "_id") obj[p] = 0;
  return Object.keys(obj).length === 0 ? null : JSON.stringify(obj);
}
