// src/lib/stores/fieldSuggestions.ts
import { sampleDocuments } from "../api/documents";
import { inferSchema } from "../domain/schema";
import { settings } from "./settings.svelte";

/** Field-name suggestions sampled from a collection, shared across every consumer (Script tab
 *  autocomplete, Pipeline Builder, Document form) so the same collection is never re-sampled
 *  redundantly. Keyed by session so entries can be dropped when a session disconnects. */
const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

function key(sessionId: string, db: string, coll: string): string {
  return `${sessionId}:${db}.${coll}`;
}

/** Sampled field-name (leaf dot-path) suggestions for (db, coll). Degrades silently to [] on any
 *  error — this is a best-effort convenience, never allowed to throw into a caller's UI. */
export async function fieldsFor(sessionId: string, db: string, coll: string): Promise<string[]> {
  const k = key(sessionId, db, coll);
  const cached = cache.get(k);
  if (cached) return cached;
  const pending = inflight.get(k);
  if (pending) return pending;
  // `holder.p` (a mutable object property, not a plain local) lets the IIFE below check its own
  // promise's identity once it settles, without TS flagging a self-referencing const/let as
  // "used before being assigned" (it can't statically prove the reference occurs only after the
  // first await, i.e. after `holder.p` is assigned).
  const holder: { p?: Promise<string[]> } = {};
  holder.p = (async () => {
    try {
      const sampledDocs = await sampleDocuments(sessionId, db, coll, "{}", 50, settings.queryTimeoutMs);
      const paths = inferSchema(sampledDocs).fields.map((f) => f.path);
      if (inflight.get(k) === holder.p) cache.set(k, paths); // don't resurrect a cache entry for a key that was disposed (or superseded) while this sample was in flight
      return paths;
    } catch {
      return [];
    } finally {
      // Only delete our own entry -- a newer in-flight call may have already replaced this key's entry.
      if (inflight.get(k) === holder.p) inflight.delete(k);
    }
  })();
  const p = holder.p;
  inflight.set(k, p);
  return p;
}

/** Drop every cached/in-flight entry for a session (call when the session disconnects/closes). */
export function disposeFieldSuggestions(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
}
