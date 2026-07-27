import { rafThrottle } from "../domain/rafThrottle";

/** Single-axis pointer drag for the app-shell splitters (sidebar width, saved-queries height,
 *  command-log height). Same shape as `createPaneResize`, minus the min/max clamping the query pane
 *  needs — the shell panels clamp inside their own store setters.
 *
 *  `sign` is how the panel grows relative to pointer movement: `1` for a panel whose dragged edge
 *  leads the pointer (the sidebar's right edge), `-1` for a panel anchored to the far edge that
 *  grows as the pointer moves back toward the start of the axis (the two bottom panels). */
export function createAxisDrag(
  axis: "x" | "y",
  getStartPx: () => number,
  setPx: (px: number) => void,
  sign: 1 | -1 = 1,
) {
  return function start(e: PointerEvent) {
    e.preventDefault();
    const origin = axis === "x" ? e.clientX : e.clientY;
    const startPx = getStartPx();
    // Pointer capture: keeps pointermove/pointerup routed here (and auto-releases on pointerup)
    // even if the drag exits the window bounds, so `up()` always fires instead of leaking listeners.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: coalesce raw pointermove ticks to at most one panel re-layout per frame.
    const move = rafThrottle((ev: PointerEvent) => {
      setPx(startPx + sign * ((axis === "x" ? ev.clientX : ev.clientY) - origin));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}
