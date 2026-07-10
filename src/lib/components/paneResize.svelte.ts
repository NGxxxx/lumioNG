import { MIN_PANE_PX } from "../stores/settings.svelte";

/** Drag handle between the Query tab's editor and its bottom (result/log) pane; mirrors `createColumnResize`'s window-listener approach but for a pane, not a grid column. */
export function createPaneResize(setEditorPx: (px: number) => void) {
  let resizing = $state(false);

  function start(e: MouseEvent, editorEl: HTMLElement, bottomEl: HTMLElement) {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startH = editorEl.getBoundingClientRect().height;
    // Editor and bottom trade space 1:1, so their combined height bounds the drag, not the container's total.
    const flexSpace = startH + bottomEl.getBoundingClientRect().height;
    const maxEditorPx = flexSpace - MIN_PANE_PX;

    function move(ev: MouseEvent) {
      const next = startH + (ev.clientY - startY);
      setEditorPx(Math.max(MIN_PANE_PX, Math.min(maxEditorPx, next)));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      resizing = false;
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return {
    get resizing() {
      return resizing;
    },
    start,
  };
}
