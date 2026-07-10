/** App-wide coordinator that keeps at most one context menu open at a time, independent of event propagation (so it still works when openers `stopPropagation()`). */
const closers = new Set<() => void>();

/** Register a context menu's close callback; any menus already open are closed first. Returns an unregister function to call on unmount. */
export function registerContextMenu(close: () => void): () => void {
  for (const other of [...closers]) {
    closers.delete(other);
    other();
  }
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}
