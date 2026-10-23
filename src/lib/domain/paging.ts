/** Pagination helpers: page count, page clamping, and skip offset. */

/** Above this row count, "Show all" asks for confirmation before fetching the whole result set. */
export const SHOW_ALL_WARN_THRESHOLD = 5000;

/** Total page count for `total` records at page `size`; minimum 1 even when empty. */
export function pageCount(total: number, size: number): number {
  if (size <= 0) return 1;
  return Math.max(1, Math.ceil(total / size));
}

/** Clamp `page` (1-based) into [1, count]; floors fractions; invalid values → 1. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  if (page > count) return count;
  return Math.floor(page);
}

/** Number of documents to skip to reach the start of `page` (1-based). */
export function skipFor(page: number, size: number): number {
  return Math.max(0, (page - 1) * size);
}

/** The rows of `page` (1-based) out of an already materialized list. */
export function pageSlice<T>(rows: T[], page: number, size: number): T[] {
  const start = skipFor(page, size);
  return rows.slice(start, start + size);
}
