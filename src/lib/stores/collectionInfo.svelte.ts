import { collStats, collOptions } from "../api/stats";
import {
  parseCollStats,
  parseCollOptions,
  type CollStatsInfo,
  type CollOptionsInfo,
} from "../domain/stats";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { collStatsCmd } from "../domain/mongosh";

/** State and loader for the collection Info tab. Components only render. */
export function createCollectionInfo(sessionId: string, db: string, coll: string) {
  let stats = $state<CollStatsInfo | null>(null);
  let options = $state<CollOptionsInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    try {
      const [s, o] = await Promise.all([collStats(sessionId, db, coll), collOptions(sessionId, db, coll)]);
      stats = parseCollStats(s);
      options = parseCollOptions(o);
      commandLog.push(collStatsCmd(coll), sessionId);
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
    get options() {
      return options;
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
