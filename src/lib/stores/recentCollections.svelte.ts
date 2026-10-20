// src/lib/stores/recentCollections.svelte.ts — collections opened lately (palette "Recent"), kept locally.
import { prefs } from "./prefs.svelte";

export const RECENT_COLLECTIONS_KEY = "lumio.recentCollections.v1";
const CAP = 20;

export type RecentCollection = { connId: number | null; db: string; coll: string };

function read(): RecentCollection[] {
  try {
    const raw = JSON.parse(prefs.getItem(RECENT_COLLECTIONS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c): c is RecentCollection =>
        !!c && typeof c === "object" && typeof (c as RecentCollection).db === "string" && typeof (c as RecentCollection).coll === "string" &&
        ((c as RecentCollection).connId === null || typeof (c as RecentCollection).connId === "number"),
    ).slice(0, CAP);
  } catch {
    return [];
  }
}

export function createRecentCollections() {
  let list = $state.raw<RecentCollection[]>(read());
  prefs.afterHydrate(() => (list = read()));

  function touch(connId: number | null, db: string, coll: string) {
    if (list[0] && list[0].connId === connId && list[0].db === db && list[0].coll === coll) return;
    list = [{ connId, db, coll }, ...list.filter((c) => !(c.connId === connId && c.db === db && c.coll === coll))].slice(0, CAP);
    try {
      prefs.setItem(RECENT_COLLECTIONS_KEY, JSON.stringify(list));
    } catch {
      // not remembered
    }
  }

  return { get list() { return list; }, touch };
}

/** App-wide singleton. */
export const recentCollections = createRecentCollections();
