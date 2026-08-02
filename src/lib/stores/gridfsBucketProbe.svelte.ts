import { countDocuments } from "../api/documents";

/** Backs the "is `<prefix>.files` empty?" fact `domain/gridfsBucket.ts`'s `detectGridFsBucket`
 *  needs for its relaxed rule (a valid GridFS bucket can have `.files` without `.chunks` yet, since
 *  the driver creates `.chunks` lazily on first chunk write). Only consulted for the ambiguous case
 *  (`.files` present, sibling `.chunks` missing) -- ordinary buckets with `.chunks` present resolve
 *  synchronously and never touch this. A tiny reactive cache, not a full store factory: mirrors
 *  `gridfsFilesCache.svelte.ts`'s plain-module-cache shape rather than the store-factory pattern,
 *  since callers only need a read (`isEmpty`) + a disposal hook, no other state/actions. */

const results = $state<Record<string, boolean>>({});
const pending = new Set<string>();

function key(sessionId: string, db: string, filesColl: string): string {
  return `${sessionId}:${db}.${filesColl}`;
}

/** Reactive read: `null` while unresolved (triggers a background `countDocuments` probe as a
 *  side effect), otherwise the cached empty/non-empty verdict. Reads `results`, so callers using it
 *  inside a `$derived`/template expression re-evaluate once the probe resolves. */
export function isGridfsFilesEmpty(sessionId: string, db: string, filesColl: string): boolean | null {
  const k = key(sessionId, db, filesColl);
  if (k in results) return results[k];
  if (!pending.has(k)) {
    pending.add(k);
    void countDocuments(sessionId, db, filesColl, "{}")
      .then((count) => {
        results[k] = count === 0;
      })
      .catch(() => {
        results[k] = false; // fail closed: never misclassify an unrelated collection as an empty bucket on error
      })
      .finally(() => pending.delete(k));
  }
  return null;
}

/** Drop all cached probes for a session (call when the session disconnects/closes). */
export function disposeGridfsBucketProbes(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of Object.keys(results)) if (k.startsWith(prefix)) delete results[k];
  for (const k of [...pending]) if (k.startsWith(prefix)) pending.delete(k);
}
