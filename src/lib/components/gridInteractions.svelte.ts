// NOTE: virtualizer create+resync wiring lives in rowVirtualizer.svelte.ts, not here — column-resize
// (this file) and row-virtualization are unrelated concerns that happened to be extracted separately.
// rowVirtualizer.svelte.ts keeps the virtualizer's own store as a store (never mirrored into
// `$state`); an earlier attempt that mirrored it into `$state` fed back into the resync effect and
// looped forever.
import { rafThrottle } from "../domain/rafThrottle";

export const GRID_ROW_H = 28;

/** `resizing` lets callers suppress a click action (e.g. sort-on-header) on mouseup. */
export function createColumnResize(getWidth: (path: string) => number, setWidth: (path: string, px: number) => void) {
  let resizing = $state(false);

  function start(e: PointerEvent, path: string) {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    const startX = e.clientX;
    const startW = getWidth(path);
    // Pointer capture: pointermove/pointerup keep routing here even outside the window bounds, so up() always fires instead of leaking listeners.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: raw pointermove can fire far more than once per frame, and each call writes
    // `$state` (a full grid column re-layout) — coalesce to at most one write per animation frame.
    const move = rafThrottle((ev: PointerEvent) => {
      setWidth(path, startW + (ev.clientX - startX));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // clear after the click event would have fired, so a header click-to-sort is suppressed
      setTimeout(() => { resizing = false; }, 0);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return {
    get resizing() { return resizing; },
    start,
  };
}
