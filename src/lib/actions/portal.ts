/**
 * Svelte action: relocate the node to `document.body` so overlays (modal backdrops,
 * context menus) render above all app content regardless of where they are declared
 * in the component tree. Being the last child of <body> puts the node on top in DOM
 * order, immune to ancestor `overflow`/stacking-context clipping. Removed on destroy.
 */
export function portal(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
