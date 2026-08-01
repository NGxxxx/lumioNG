import { createGridfsFiles } from "./gridfsFiles.svelte";

type Entry = { version: number; store: ReturnType<typeof createGridfsFiles>; dispose: () => void };

// Plain Map (NOT $state): each store already owns its runes state; wrapping the Map in $state
// would double-proxy those stores. Mirrors stores/collectionViews.svelte.ts.
const cache = new Map<string, Entry>();

const key = (sessionId: string, db: string, bucket: string) => `${sessionId}:${db}.${bucket}`;

function evict(k: string) {
  cache.get(k)?.dispose();
  cache.delete(k);
}

/** Get (creating + caching) the GridFS file list store for sessionId/db/bucket; only the active
 *  bucket is kept per session, mirroring `collectionViews.svelte.ts`'s eviction policy. */
export function getGridfsFiles(sessionId: string, db: string, bucket: string, version: number) {
  const k = key(sessionId, db, bucket);
  const hit = cache.get(k);
  if (hit && hit.version === version) return hit.store;
  const prefix = `${sessionId}:`;
  for (const other of cache.keys()) if (other.startsWith(prefix) && other !== k) evict(other);
  let store!: ReturnType<typeof createGridfsFiles>;
  const dispose = $effect.root(() => {
    store = createGridfsFiles(sessionId, db, bucket);
  });
  cache.set(k, { version, store, dispose });
  return store;
}

/** Drop all cached GridFS file-list stores for a session (call when the session disconnects/closes). */
export function disposeGridfsFiles(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) evict(k);
}
