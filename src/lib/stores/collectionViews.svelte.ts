import { createCollectionView } from "./collectionView.svelte";

/** A cached view, its loaded version, and the root effect owning its $derived fields (see `evict`). */
type Entry = { version: number; view: ReturnType<typeof createCollectionView>; dispose: () => void };

// Plain Map (NOT $state): each store already owns its runes state; wrapping the Map in $state would double-proxy those stores.
const cache = new Map<string, Entry>();

const key = (sessionId: string, db: string, coll: string) => `${sessionId}:${db}.${coll}`;

// Filter text to put in a view's box the first time it is created (session restore). Text only: it is never applied.
const seededFilters = new Map<string, string>();

/** Filter box text of the cached view for sessionId/db/coll ("" when that view is not open). */
export function peekFilterText(sessionId: string, db: string, coll: string): string {
  return cache.get(key(sessionId, db, coll))?.view.filterText ?? "";
}

/** Pre-fills the filter box of a collection view that is about to be opened. */
export function seedFilterText(sessionId: string, db: string, coll: string, text: string): void {
  if (text) seededFilters.set(key(sessionId, db, coll), text);
}

function evict(k: string) {
  cache.get(k)?.dispose();
  cache.delete(k);
}

/** Get (creating + caching) the collection view for sessionId/db/coll; only the active collection is kept per session, so switching collections evicts the rest instead of piling up in RAM. */
export function getCollectionView(sessionId: string, db: string, coll: string, version: number) {
  const k = key(sessionId, db, coll);
  const hit = cache.get(k);
  if (hit && hit.version === version) return { view: hit.view, isNew: false };
  const prefix = `${sessionId}:`;
  for (const other of cache.keys()) if (other.startsWith(prefix) && other !== k) evict(other);
  // $effect.root: keeps the view's $derived fields alive across ResultTable unmount/remount.
  let view!: ReturnType<typeof createCollectionView>;
  const dispose = $effect.root(() => {
    view = createCollectionView(sessionId, db, coll);
  });
  const seed = seededFilters.get(k);
  if (seed !== undefined) {
    seededFilters.delete(k);
    view.filterText = seed;
  }
  cache.set(k, { version, view, dispose });
  return { view, isNew: true };
}

/** Drop all cached views for a session (call when the session disconnects/closes). */
export function disposeCollectionViews(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) evict(k);
}
