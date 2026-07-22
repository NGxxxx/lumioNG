/** Svelte action: relocates the node to `document.body` so overlays render above all app content, immune to ancestor overflow/stacking clipping. */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
