/**
 * App-wide coordinator that keeps at most one context menu open at a time.
 *
 * Each mounted `ContextMenu` registers its `onclose` here; registering a new menu
 * first closes every other open menu. Unlike the per-menu `window` listeners, this
 * is independent of event propagation, so it still works when openers call
 * `stopPropagation()` to avoid the self-close race — which is exactly the case that
 * let a sidebar menu and a data-table menu stay open simultaneously.
 */
const closers = new Set<() => void>();

/**
 * Register a context menu's close callback. Any menus already open are closed
 * (and dropped) first. Returns an unregister function to call on unmount.
 */
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
