import { listIndexes, createIndex, dropIndex } from "../api/indexes";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { createIndexCmd, dropIndexCmd } from "../domain/mongosh";

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
    try {
      const raw = await listIndexes(sessionId, db, coll);
      indexes = parseIndexList(raw);
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
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
    await createIndex(sessionId, db, coll, keys, unique, trimmed);
    const opts: Record<string, unknown> = {};
    if (unique) opts.unique = true;
    if (trimmed) opts.name = trimmed;
    commandLog.push(createIndexCmd(coll, JSON.parse(keys) as Record<string, unknown>, Object.keys(opts).length ? opts : undefined), sessionId);
    await refresh();
  }

  async function drop(name: string) {
    await dropIndex(sessionId, db, coll, name);
    commandLog.push(dropIndexCmd(coll, name), sessionId);
    await refresh();
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
