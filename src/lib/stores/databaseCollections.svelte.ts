import { namespaceTree } from "./namespaceTree.svelte";
import { collStats, dbStats } from "../api/stats";
import { parseCollStats, parseDbStats, type CollStatsInfo, type DbStatsInfo } from "../domain/stats";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { collStatsCmd, dbStatsCmd } from "../domain/mongosh";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { countCollection } from "./destructiveCounts";
import { sessionEnvironment } from "./sessionEnv";

type TreeLike = {
  readonly databases: { name: string; collections: string[] }[];
  truncate?: (db: string, coll: string) => Promise<void>;
  dropCollection?: (db: string, coll: string) => Promise<void>;
};

export type RowState = "idle" | "loading" | "loaded" | "error";
export interface CollRow {
  name: string;
  state: RowState;
  stats: CollStatsInfo | null;
  error: string | null;
}
export type SortCol = "name" | "count" | "avgObjSize" | "storageSize" | "nindexes" | "totalIndexSize";

/** State + loaders for the Database tab's collection grid (names eager, stats lazy). */
export function createDatabaseCollections(sessionId: string, db: string, tree: TreeLike = namespaceTree) {
  let rows = $state<CollRow[]>([]);
  let summary = $state<DbStatsInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let sortCol = $state<SortCol>("name");
  let sortDir = $state<"asc" | "desc">("asc");
  /** Bumped on every init() call so a slower, superseded call can't overwrite fresher state. */
  let generation = 0;

  function names(): string[] {
    return tree.databases.find((d) => d.name === db)?.collections ?? [];
  }

  async function init() {
    loading = true;
    const gen = ++generation;
    rows = names().map((name) => ({ name, state: "idle", stats: null, error: null }));
    try {
      const s = await commandLog.pushTimed(dbStatsCmd(), sessionId, () => dbStats(sessionId, db));
      if (gen !== generation) return;
      summary = parseDbStats(s);
      error = null;
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
    }
  }

  async function loadStats(name: string) {
    const row = rows.find((r) => r.name === name);
    if (!row || row.state === "loading") return;
    row.state = "loading";
    try {
      const s = parseCollStats(
        await commandLog.pushTimed(collStatsCmd(name), sessionId, () => collStats(sessionId, db, name)),
      );
      row.stats = s;
      row.state = "loaded";
      row.error = null;
    } catch (e) {
      row.state = "error";
      row.error = errorMessage(e);
    }
  }

  async function loadAll() {
    await Promise.all(rows.filter((r) => r.state === "idle").map((r) => loadStats(r.name)));
  }

  function setSort(col: SortCol) {
    if (sortCol === col) sortDir = sortDir === "asc" ? "desc" : "asc";
    else {
      sortCol = col;
      sortDir = "asc";
    }
  }

  const sorted = $derived.by(() => {
    const arr = [...rows];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortCol === "name") return a.name.localeCompare(b.name) * dir;
      const av = a.stats ? a.stats[sortCol] : null;
      const bv = b.stats ? b.stats[sortCol] : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls always last
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
    return arr;
  });

  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  /** Drop / truncate several collections after one confirmation (total count, PROD policy). Each
   *  collection runs independently; `done` gets the names that failed. */
  function requestBulk(kind: "drop" | "truncate", colls: string[], done: (failed: string[]) => void) {
    if (colls.length === 0) return;
    void destructive.request(
      {
        op: kind === "drop" ? "dropCollection" : "truncate",
        target: { db, coll: colls.length === 1 ? colls[0] : undefined, colls },
        fetchCount: async () => {
          let total = 0;
          for (const c of colls) total += (await countCollection(sessionId, db, c)).count;
          return total;
        },
      },
      async () => {
        const failed: string[] = [];
        for (const c of colls) {
          try {
            if (kind === "truncate") await tree.truncate?.(db, c);
            else await tree.dropCollection?.(db, c);
          } catch {
            failed.push(c);
          }
        }
        await init();
        done(failed);
      },
    );
  }

  return {
    /** The bulk drop / truncate waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
    requestBulk,
    get rows() { return sorted; },
    get summary() { return summary; },
    get error() { return error; },
    get loading() { return loading; },
    get sortCol() { return sortCol; },
    get sortDir() { return sortDir; },
    init,
    loadStats,
    loadAll,
    setSort,
  };
}
