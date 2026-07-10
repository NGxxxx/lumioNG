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
  /** Bumped on every refresh() call so a slower, superseded call can't overwrite fresher state. */
  let generation = 0;

  async function refresh() {
    loading = true;
    const gen = ++generation;
    try {
      const [s, o] = await commandLog.pushTimed(collStatsCmd(coll), sessionId, () =>
        Promise.all([collStats(sessionId, db, coll), collOptions(sessionId, db, coll)]));
      if (gen !== generation) return;
      stats = parseCollStats(s);
      options = parseCollOptions(o);
      error = null;
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      if (gen === generation) loading = false;
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
