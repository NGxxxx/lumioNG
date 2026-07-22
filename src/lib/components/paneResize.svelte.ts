import { MIN_PANE_PX } from "../stores/settings.svelte";
import { rafThrottle } from "../domain/rafThrottle";

/** Drag handle between the Query tab's editor and its bottom (result/log) pane; mirrors `createColumnResize`'s window-listener approach but for a pane, not a grid column. */
export function createPaneResize(setEditorPx: (px: number) => void) {
  let resizing = $state(false);

  function start(e: PointerEvent, editorEl: HTMLElement, bottomEl: HTMLElement) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startH = editorEl.getBoundingClientRect().height;
    // Editor and bottom trade space 1:1, so their combined height bounds the drag, not the container's total.
    const flexSpace = startH + bottomEl.getBoundingClientRect().height;
    const maxEditorPx = flexSpace - MIN_PANE_PX;

    // Pointer capture: keeps pointermove/pointerup routed here (and auto-releases on pointerup) even
    // if the drag exits the window bounds, so `up()` always fires instead of leaking listeners.
    (e.target as Element).setPointerCapture(e.pointerId);
    // rAF-throttled: coalesce raw pointermove ticks to at most one pane re-layout per frame.
    const move = rafThrottle((ev: PointerEvent) => {
      const next = startH + (ev.clientY - startY);
      setEditorPx(Math.max(MIN_PANE_PX, Math.min(maxEditorPx, next)));
    });
    function up() {
      move.cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      resizing = false;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return {
    get resizing() {
      return resizing;
    },
    start,
  };
}
