import { listIndexes, createIndex, dropIndex } from "../api/indexes";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";

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
    await refresh();
  }

  async function drop(name: string) {
    await dropIndex(db, coll, name);
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
