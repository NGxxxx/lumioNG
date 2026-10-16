/** Viewport placement for pop-up menus, so a menu opened near an edge stays fully visible. */

interface Viewport {
  vw: number;
  vh: number;
  /** Minimum gap to keep from the window edges. */
  margin: number;
}

/** Where to put a menu opened at the pointer (`x`, `y`): below/right of it when that fits, otherwise
 *  flipped up/left; a menu taller than the window gets `maxHeight` and scrolls. */
export function placeMenu(p: { x: number; y: number; width: number; height: number } & Viewport): {
  left: number;
  top: number;
  maxHeight: number | null;
} {
  const { x, y, width, height, vw, vh, margin } = p;
  const room = vh - 2 * margin;
  let top: number;
  let maxHeight: number | null = null;
  if (height > room) {
    top = margin;
    maxHeight = room;
  } else if (y + height <= vh - margin) {
    top = y;
  } else if (y - height >= margin) {
    top = y - height;
  } else {
    top = vh - margin - height;
  }
  const left = x + width <= vw - margin ? x : Math.max(margin, x - width);
  return { left, top, maxHeight };
}

/** Which side of its parent item a submenu opens on, and how far to move it up to stay on screen
 *  (it starts aligned with the parent's top). */
export function placeSubmenu(p: {
  parent: { top: number; bottom: number; left: number; right: number };
  width: number;
  height: number;
} & Viewport): { side: "left" | "right"; shiftY: number } {
  const { parent, width, height, vw, vh, margin } = p;
  const side = parent.right + width <= vw - margin || parent.left - width < margin ? "right" : "left";
  const overflow = parent.top + height - (vh - margin);
  const shiftY = overflow > 0 ? -Math.min(overflow, parent.top - margin) : 0;
  return { side, shiftY };
}
