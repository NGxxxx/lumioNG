import { listIndexes, createIndex, dropIndex } from "../api/indexes";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { createIndexCmd, dropIndexCmd } from "../domain/mongosh";

/**
 * Trạng thái + hành động của tab Indexes cho một collection.
 * Component chỉ render và gọi action; logic parse/build/validate nằm ở domain.
 */
export function createIndexView(db: string, coll: string) {
  let indexes = $state<IndexInfo[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);

  async function refresh() {
    loading = true;
    try {
      const raw = await listIndexes(db, coll);
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
    await createIndex(db, coll, keys, unique, trimmed);
    const opts: Record<string, unknown> = {};
    if (unique) opts.unique = true;
    if (trimmed) opts.name = trimmed;
    commandLog.push(createIndexCmd(coll, JSON.parse(keys) as Record<string, unknown>, Object.keys(opts).length ? opts : undefined));
    await refresh();
  }

  async function drop(name: string) {
    await dropIndex(db, coll, name);
    commandLog.push(dropIndexCmd(coll, name));
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
