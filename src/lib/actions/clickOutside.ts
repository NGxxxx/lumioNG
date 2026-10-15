/** Calls `onOut` on any pointer-down outside `node` (popovers, dropdown groups). */
export function clickOutside(node: HTMLElement, onOut: () => void) {
  let cb = onOut;
  function handle(e: PointerEvent) {
    if (!node.contains(e.target as Node)) cb();
  }
  document.addEventListener("pointerdown", handle, true);
  return {
    update(next: () => void) {
      cb = next;
    },
    destroy() {
      document.removeEventListener("pointerdown", handle, true);
    },
  };
}
