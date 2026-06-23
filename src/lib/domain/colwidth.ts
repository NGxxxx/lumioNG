import { getByPath, type ColumnField } from "./schema";
import { describeValue } from "./extjson";
import type { Doc } from "./doc";

const CHAR_PX = 7; // approximate px per character at the grid font size
const PAD_PX = 20; // cell horizontal padding + a little breathing room
const BADGE_CHARS = 6; // chars reserved in the header for the type badge

export const MIN_COL_W = 48;
export const MAX_COL_W = 480;

/** Clamp + round a pixel width into the allowed column range. */
export function clampWidth(px: number): number {
  return Math.max(MIN_COL_W, Math.min(MAX_COL_W, Math.round(px)));
}

/**
 * Derive an initial width (px) per column from the longer of its header label
 * (plus a badge allowance when the column has a type) and the longest displayed
 * value across `docs`. Pure: no DOM, depends only on the data passed in.
 */
export function computeColumnWidths(fields: ColumnField[], docs: Doc[]): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const f of fields) {
    const headerLen = f.path.length + (f.type ? BADGE_CHARS : 0);
    let contentLen = 0;
    for (const doc of docs) {
      const val = getByPath(doc, f.path);
      if (val === undefined) continue;
      const len = describeValue(val).display.length;
      if (len > contentLen) contentLen = len;
    }
    widths[f.path] = clampWidth(Math.max(headerLen, contentLen) * CHAR_PX + PAD_PX);
  }
  return widths;
}
