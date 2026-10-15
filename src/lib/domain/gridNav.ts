/** Pure keyboard-navigation math for the grid; positions are display positions 0..rowCount-1. All helpers return new state and never mutate their input. */
export type NavState = { cursor: number | null; anchor: number | null; selected: Set<number> };

const clamp = (pos: number, rowCount: number) => Math.max(0, Math.min(rowCount - 1, pos));

/** Single-select the position `pos` (clamped); unchanged on an empty grid. */
export function jumpTo(s: NavState, pos: number, rowCount: number): NavState {
  if (rowCount <= 0) return s;
  const p = clamp(pos, rowCount);
  return { cursor: p, anchor: p, selected: new Set([p]) };
}

/** Move the cursor by `delta` and single-select it; from no cursor, goes to the first (delta > 0) or last (delta < 0) row. */
export function moveCursor(s: NavState, delta: number, rowCount: number): NavState {
  if (rowCount <= 0) return s;
  if (s.cursor === null) return jumpTo(s, delta < 0 ? rowCount - 1 : 0, rowCount);
  return jumpTo(s, s.cursor + delta, rowCount);
}

/** Select the inclusive range anchor..pos (anchor defaults to pos when unset) and move the cursor to pos. */
export function extendTo(s: NavState, pos: number, rowCount: number): NavState {
  if (rowCount <= 0) return s;
  const p = clamp(pos, rowCount);
  const anchor = s.anchor ?? p;
  const selected = new Set<number>();
  for (let i = Math.min(anchor, p); i <= Math.max(anchor, p); i++) selected.add(i);
  return { cursor: p, anchor, selected };
}

/** Toggle `pos` in the selection (others kept), moving cursor and anchor to it. */
export function toggleAt(s: NavState, pos: number): NavState {
  const selected = new Set(s.selected);
  if (!selected.delete(pos)) selected.add(pos);
  return { cursor: pos, anchor: pos, selected };
}
