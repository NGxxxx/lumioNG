import { getBySegments, type ColumnField } from "./schema";
import { describeValue } from "./extjson";
import type { Doc } from "./doc";

const CHAR_PX = 7; // approximate px per character at the grid font size
const PAD_PX = 20; // cell horizontal padding + a little breathing room
const BADGE_CHARS = 6; // chars reserved in the header for the type badge

export const MIN_COL_W = 48;
export const MAX_COL_W = 480;

/** Docs scanned to size columns: a leading sample yields effectively the same widths as a full scan at a fraction of the cost. */
export const COLWIDTH_SAMPLE = 200;

/** Clamp + round a pixel width into the allowed column range. */
export function clampWidth(px: number): number {
  return Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(px)));
}

/** Derive an initial width (px) per column from the longer of its header label and the longest displayed value across `docs`; pure, no DOM. */
export function computeColumnWidths(fields: ColumnField[], docs: Doc[]): Record<string, number> {
  const sample = docs.length > COLWIDTH_SAMPLE ? docs.slice(0, COLWIDTH_SAMPLE) : docs;
  const widths: Record<string, number> = {};
  for (const f of fields) {
    const headerLen = f.path.length + (f.type ? BADGE_CHARS : 0);
    const segs = f.path.split("."); // split once per column, not once per (column, doc)
    let contentLen = 0;
    for (const doc of sample) {
      const val = getBySegments(doc, segs);
      if (val === undefined) continue;
      const len = describeValue(val).display.length;
      if (len > contentLen) contentLen = len;
    }
    widths[f.path] = clampWidth(Math.max(headerLen, contentLen) * CHAR_PX + PAD_PX);
  }
  return widths;
}

/** Sticky `left` offset (px) for each pinned path; pinned columns render first, in display order, after the row-number column. */
export function pinnedOffsets(
  paths: string[],
  widths: Record<string, number>,
  pinned: Set<string>,
  rownumW: number,
  fallbackW: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let left = rownumW;
  for (const p of paths) {
    if (!pinned.has(p)) continue;
    out[p] = left;
    left += widths[p] ?? fallbackW;
  }
  return out;
}

/** Display order with pinned columns first; relative order is kept on both sides. */
export function pinnedFirst<T extends { path: string }>(cols: T[], pinned: ReadonlySet<string>): T[] {
  if (pinned.size === 0) return cols;
  return [...cols.filter((c) => pinned.has(c.path)), ...cols.filter((c) => !pinned.has(c.path))];
}

export interface ColumnWindow {
  /** First rendered column (inclusive) and last (exclusive). */
  start: number;
  end: number;
  /** Total width of the skipped columns on each side, rendered as spacers. */
  before: number;
  after: number;
}

/** Horizontal virtualization: which columns of `widths` overlap `[offset, offset + viewport)` widened by
 *  `overscan` px each side. `mustInclude` (e.g. the column being edited) is always kept in the window. */
export function columnWindow(
  widths: readonly number[],
  offset: number,
  viewport: number,
  overscan: number,
  mustInclude?: number,
): ColumnWindow {
  const lo = Math.max(0, offset - overscan);
  const hi = offset + viewport + overscan;
  let start = widths.length;
  let end = 0;
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = x + widths[i];
    if (next > lo && x < hi) {
      if (i < start) start = i;
      end = i + 1;
    }
    x = next;
  }
  if (start > end) start = end = 0;
  if (mustInclude !== undefined && mustInclude >= 0 && mustInclude < widths.length) {
    start = Math.min(start, mustInclude);
    end = Math.max(end, mustInclude + 1);
  }
  let before = 0;
  for (let i = 0; i < start; i++) before += widths[i];
  let span = 0;
  for (let i = start; i < end; i++) span += widths[i];
  return { start, end, before, after: x - before - span };
}
