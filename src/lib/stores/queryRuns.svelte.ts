import { createQueryRun } from "./queryRun.svelte";

/** A single Query tab's run store. */
export type QueryRun = ReturnType<typeof createQueryRun>;

// Plain Map (NOT $state): each store already owns its runes state; wrapping the
// Map in $state would double-proxy those stores.
const runs = new Map<number, QueryRun>();

/** Get (creating + caching on first call) the run store for a query tab id. */
export function getQueryRun(id: number, initialStatement: string): QueryRun {
  let r = runs.get(id);
  if (!r) {
    r = createQueryRun(initialStatement);
    runs.set(id, r);
  }
  return r;
}

/** Drop a query tab's run store (call when the tab closes). No-op for unknown ids. */
export function disposeQueryRun(id: number): void {
  runs.delete(id);
}
