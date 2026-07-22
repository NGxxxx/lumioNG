/** Svelte action for modal backdrops: fires `handler` only when both pointerdown and click land on the backdrop itself (avoids closing mid text-drag). */
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
