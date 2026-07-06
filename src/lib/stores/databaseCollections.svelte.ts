import { namespaceTree } from "./namespaceTree.svelte";
import { collStats, dbStats } from "../api/stats";
import { parseCollStats, parseDbStats, type CollStatsInfo, type DbStatsInfo } from "../domain/stats";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { collStatsCmd, dbStatsCmd } from "../domain/mongosh";

type TreeLike = { readonly databases: { name: string; collections: string[] }[] };

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

  function names(): string[] {
    return tree.databases.find((d) => d.name === db)?.collections ?? [];
  }

  async function init() {
    loading = true;
    rows = names().map((name) => ({ name, state: "idle", stats: null, error: null }));
    try {
      summary = parseDbStats(await commandLog.pushTimed(dbStatsCmd(), sessionId, () => dbStats(sessionId, db)));
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
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

  return {
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
