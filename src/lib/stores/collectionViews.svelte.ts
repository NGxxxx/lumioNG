import { createCollectionView } from "./collectionView.svelte";

/** A single collection view's store, plus the version it was last loaded at. */
type Entry = { version: number; view: ReturnType<typeof createCollectionView> };

// Plain Map (NOT $state): each store already owns its runes state; wrapping the
// Map in $state would double-proxy those stores.
const cache = new Map<string, Entry>();

const key = (sessionId: string, db: string, coll: string) => `${sessionId}:${db}.${coll}`;

/**
 * Get (creating + caching) the collection view for sessionId/db/coll. Reusing the same
 * view across remounts is what lets the Data pane survive a Query<->Data tab switch without
 * refetching: `isNew` is false whenever `version` matches the last call, so the caller can
 * skip re-init. A version bump (manual refresh, via `nav.bumpCollection`) or a different
 * db/coll always produces a fresh view with `isNew: true`.
 */
export function getCollectionView(sessionId: string, db: string, coll: string, version: number) {
  const k = key(sessionId, db, coll);
  const hit = cache.get(k);
  if (hit && hit.version === version) return { view: hit.view, isNew: false };
  const view = createCollectionView(sessionId, db, coll);
  cache.set(k, { version, view });
  return { view, isNew: true };
}

/** Drop all cached views for a session (call when the session disconnects/closes). */
export function disposeCollectionViews(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
