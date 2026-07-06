import { listIndexes, createIndex, dropIndex } from "../api/indexes";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import * as m from "$lib/paraglide/messages";
import { createIndexCmd, dropIndexCmd, listIndexesCmd } from "../domain/mongosh";

/**
 * State and actions for the Indexes tab of a collection.
 * Components only render and invoke actions; parse/build/validate logic lives in domain.
 */
export function createIndexView(sessionId: string, db: string, coll: string) {
  let indexes = $state<IndexInfo[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    activity.begin(m.common_running());
    try {
      const raw = await commandLog.pushTimed(listIndexesCmd(coll), sessionId, () =>
        listIndexes(sessionId, db, coll));
      indexes = parseIndexList(raw);
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
      activity.end();
    }
  }

  async function create(
    fields: { field: string; dir: 1 | -1 }[],
    unique: boolean,
    name: string | null,
  ) {
    const msg = validateIndexFields(fields);
    if (msg) throw msg;
    const keys = buildIndexKeys(fields);
    const trimmed = name && name.trim() ? name.trim() : null;
    activity.begin(m.common_running());
    const opts: Record<string, unknown> = {};
    if (unique) opts.unique = true;
    if (trimmed) opts.name = trimmed;
    try {
      await commandLog.pushTimed(
        createIndexCmd(coll, JSON.parse(keys) as Record<string, unknown>, Object.keys(opts).length ? opts : undefined),
        sessionId,
        () => createIndex(sessionId, db, coll, keys, unique, trimmed),
      );
      await refresh();
    } finally {
      activity.end();
    }
  }

  async function drop(name: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropIndexCmd(coll, name), sessionId, () =>
        dropIndex(sessionId, db, coll, name));
      await refresh();
    } finally {
      activity.end();
    }
  }

  return {
    get indexes() {
      return indexes;
    },
    get error() {
      return error;
    },
    get loading() {
      return loading;
    },
    init: refresh,
    refresh,
    create,
    drop,
  };
}
