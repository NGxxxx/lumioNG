import type { WatchTab } from "./navigation.svelte";
import { createWatch, type Watch } from "./watch.svelte";
import { createQueryWatch, type QueryWatch } from "./queryWatch.svelte";

export type WatchMode = "changes" | "queries";

export interface WatchSession {
  changes: Watch;
  queries: QueryWatch;
  mode: WatchMode;
  /** Either mode is capturing right now (drives the tab strip's live dot). */
  readonly recording: boolean;
}

function createWatchSession(tab: WatchTab, mode: WatchMode): WatchSession {
  const changes = createWatch(tab.sessionId, { db: tab.db, coll: tab.coll, idText: tab.idText });
  const queries = createQueryWatch(tab.sessionId, { db: tab.db, coll: tab.coll });
  let current = $state<WatchMode>(mode);
  // The change stream starts the first time its mode is shown; the profiler only when the user asks
  // (it changes server settings).
  let changesStarted = false;
  function show(v: WatchMode) {
    current = v;
    if (v === "changes" && !changesStarted) {
      changesStarted = true;
      void changes.start();
    }
  }
  show(mode);
  return {
    changes,
    queries,
    get mode() { return current; },
    set mode(v: WatchMode) { show(v); },
    get recording() { return changes.status === "recording" || queries.status === "recording"; },
  };
}

// Plain Map (NOT $state): each store owns its runes state. Keyed by tab id, so a recording keeps
// running while its tab is in the background and stops only when the tab (or its session) closes.
const sessions = new Map<number, WatchSession>();

/** The tab's recordings, created on first access. */
export function getWatch(tab: WatchTab, mode: WatchMode = "changes"): WatchSession {
  let w = sessions.get(tab.id);
  if (!w) {
    w = createWatchSession(tab, mode);
    sessions.set(tab.id, w);
  }
  return w;
}

/** Already-created recordings for a tab id (no side effects), e.g. for the tab strip's live dot. */
export function peekWatch(id: number): WatchSession | undefined {
  return sessions.get(id);
}

/** Stops both recordings (restoring the profiler) and forgets them. No-op for unknown ids. */
export function disposeWatch(id: number): void {
  const w = sessions.get(id);
  w?.changes.dispose();
  w?.queries.dispose();
  sessions.delete(id);
}
