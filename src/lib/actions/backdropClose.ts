/**
 * Svelte action for modal backdrops: calls `handler` only when both the mousedown/pointerdown
 * AND the click (which fires at mouseup) land on the backdrop element itself. A plain
 * `onclick={(e) => e.target === e.currentTarget && close()}` fires at mouseup regardless of
 * where the drag started — so selecting text inside the dialog and releasing the mouse outside
 * it (a very easy accidental drag) closes the dialog mid-selection. Tracking pointerdown fixes that.
 */
export function backdropClose(node: HTMLElement, handler: () => void) {
  let armed = false;

  function onPointerDown(e: PointerEvent) {
    armed = e.target === node;
  }
  function onClick(e: MouseEvent) {
    const wasArmed = armed;
    armed = false;
    if (wasArmed && e.target === node) handler();
  }

  node.addEventListener("pointerdown", onPointerDown);
  node.addEventListener("click", onClick);

  return {
    update(newHandler: () => void) {
      handler = newHandler;
    },
    destroy() {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("click", onClick);
    },
  };
}
