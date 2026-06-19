import { collStats, collOptions } from "../api/stats";
import {
  parseCollStats,
  parseCollOptions,
  type CollStatsInfo,
  type CollOptionsInfo,
} from "../domain/stats";
import { errorMessage } from "../api/errors";

/** Trạng thái + nạp số liệu tab Info cho một collection. Component chỉ render. */
export function createCollectionInfo(db: string, coll: string) {
  let stats = $state<CollStatsInfo | null>(null);
  let options = $state<CollOptionsInfo | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    try {
      const [s, o] = await Promise.all([collStats(db, coll), collOptions(db, coll)]);
      stats = parseCollStats(s);
      options = parseCollOptions(o);
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
