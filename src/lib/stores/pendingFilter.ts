// src/lib/stores/pendingFilter.ts — a filter to apply when a collection's Data view next opens
// (e.g. "Open in <coll> tab" from a followed reference). Taken once.
const pending = new Map<string, string>();
const key = (sessionId: string, db: string, coll: string) => `${sessionId}:${db}.${coll}`;

export function setPendingFilter(sessionId: string, db: string, coll: string, filterText: string) {
  pending.set(key(sessionId, db, coll), filterText);
}

export function takePendingFilter(sessionId: string, db: string, coll: string): string | null {
  const k = key(sessionId, db, coll);
  const v = pending.get(k) ?? null;
  pending.delete(k);
  return v;
}
