import { dbStats } from "../api/stats";
import { parseDbStats, type DbStatsInfo } from "../domain/stats";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { dbStatsCmd } from "../domain/mongosh";

/** Trạng thái + nạp số liệu tab Stats cho một database. Component chỉ render. */
export function createDatabaseStats(db: string) {
  let stats = $state<DbStatsInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    try {
      stats = parseDbStats(await dbStats(db));
      commandLog.push(dbStatsCmd());
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  return {
    get stats() {
      return stats;
    },
    get error() {
      return error;
    },
    get loading() {
      return loading;
    },
    init: refresh,
    refresh,
  };
}
