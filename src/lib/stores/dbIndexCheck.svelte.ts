// src/lib/stores/dbIndexCheck.svelte.ts — on-demand "check indexes in this database": lists unused /
// rarely used indexes across collections. Runs only when started, ≤ 4 collections at a time, cancellable.
import { listIndexes, indexStats } from "../api/indexes";
import { collStats } from "../api/stats";
import { isMaster } from "../api/mongoServer";
import { findById } from "../api/documents";
import { parseIndexList } from "../domain/indexes";
import { parseCollStats } from "../domain/stats";
import { buildIndexRows, dataDays, parseIndexStats, parseServerTraits, parseShardKey, type IndexRow } from "../domain/indexUsage";

export const DB_INDEX_CHECK_CONCURRENCY = 4;
export type DbIndexRow = IndexRow & { coll: string };

export function createDbIndexCheck(sessionId: string, db: string, collections: () => string[]) {
  let running = $state(false);
  let done = $state(0);
  let total = $state(0);
  let rows = $state.raw<DbIndexRow[]>([]);
  let failed = $state.raw<string[]>([]);
  /** Fewest whole days of usage data among the checked collections (a restart resets counters). */
  let minDays = $state<number | null>(null);
  let gen = 0;
  let sharded = false;

  async function checkOne(coll: string): Promise<DbIndexRow[]> {
    const [list, stats, cs, cfg] = await Promise.all([
      listIndexes(sessionId, db, coll),
      indexStats(sessionId, db, coll),
      collStats(sessionId, db, coll).catch(() => "{}"),
      sharded ? findById(sessionId, "config", "collections", JSON.stringify(`${db}.${coll}`)).catch(() => null) : null,
    ]);
    const usage = parseIndexStats(stats);
    const days = dataDays(usage, Date.now());
    if (days !== null) minDays = minDays === null ? days : Math.min(minDays, days);
    const sizes = Object.fromEntries(
      parseCollStats(cs).indexSizes.filter((x) => x.bytes !== null).map((x) => [x.name, x.bytes as number]),
    );
    return buildIndexRows(parseIndexList(list), usage, sizes, Date.now(), parseShardKey(cfg))
      .filter((r) => r.status === "unused" || r.status === "rare")
      .map((r) => ({ ...r, coll }));
  }

  async function start() {
    const my = ++gen;
    const queue = collections().filter((c) => !c.startsWith("system."));
    total = queue.length;
    done = 0;
    rows = [];
    failed = [];
    minDays = null;
    running = true;
    sharded = parseServerTraits(await isMaster(sessionId).catch(() => null)).topology === "sharded";
    if (my !== gen) return;
    let next = 0;
    async function worker() {
      while (my === gen && next < queue.length) {
        const coll = queue[next++];
        try {
          const found = await checkOne(coll);
          if (my !== gen) return;
          if (found.length) rows = [...rows, ...found].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
        } catch {
          if (my !== gen) return;
          failed = [...failed, coll]; // e.g. a view, or no privilege: the others still run
        }
        done++;
      }
    }
    await Promise.all(Array.from({ length: Math.min(DB_INDEX_CHECK_CONCURRENCY, queue.length) }, worker));
    if (my === gen) running = false;
  }

  function cancel() {
    gen++;
    running = false;
  }

  return {
    get running() { return running; },
    get done() { return done; },
    get total() { return total; },
    get rows() { return rows; },
    get failed() { return failed; },
    get minDays() { return minDays; },
    start,
    cancel,
  };
}

export type DbIndexCheck = ReturnType<typeof createDbIndexCheck>;
