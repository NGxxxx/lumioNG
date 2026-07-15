import { createCollectionView } from "./collectionView.svelte";

/** A cached view, its loaded version, and the root effect owning its $derived fields (see `evict`). */
type Entry = { version: number; view: ReturnType<typeof createCollectionView>; dispose: () => void };

// Plain Map (NOT $state): each store already owns its runes state; wrapping the Map in $state would double-proxy those stores.
const cache = new Map<string, Entry>();

const key = (sessionId: string, db: string, coll: string) => `${sessionId}:${db}.${coll}`;

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
  cache.set(k, { version, view, dispose });
  return { view, isNew: true };
}

/** Drop all cached views for a session (call when the session disconnects/closes). */
export function disposeCollectionViews(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) evict(k);
}
