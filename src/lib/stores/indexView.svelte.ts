import { listIndexes, createIndex, dropIndex } from "../api/indexes";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import * as m from "#lib/paraglide/messages.js";
import { createIndexCmd, dropIndexCmd, listIndexesCmd } from "../domain/mongosh";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** State and actions for the Indexes tab of a collection; parse/build/validate logic lives in domain. */
export function createIndexView(sessionId: string, db: string, coll: string) {
  let indexes = $state<IndexInfo[]>([]);
  const guard = createAsyncGuard();

  async function refresh() {
    const gen = guard.begin();
    activity.begin(m.common_running());
    try {
      const raw = await commandLog.pushTimed(listIndexesCmd(coll), sessionId, () =>
        listIndexes(sessionId, db, coll));
      if (!guard.isCurrent(gen)) return;
      indexes = parseIndexList(raw);
      guard.setError(null);
    } catch (e) {
      if (!guard.isCurrent(gen)) return;
      guard.setError(errorMessage(e));
    } finally {
      guard.finish(gen);
      activity.end();
    }
  }

  async function create(
    fields: { field: string; dir: 1 | -1 }[],
    unique: boolean,
    name: string | null,
    sparse: boolean,
    ttlSeconds: number | null,
    partialFilter: string,
    collation: string,
  ) {
    const msg = validateIndexFields(fields);
    if (msg) throw msg;
    const keys = buildIndexKeys(fields);
    const trimmed = name && name.trim() ? name.trim() : null;
    const pf = partialFilter.trim() ? partialFilter.trim() : null;
    const coln = collation.trim() ? collation.trim() : null;
    activity.begin(m.common_running());
    try {
      const opts: Record<string, unknown> = {};
      if (unique) opts.unique = true;
      if (sparse) opts.sparse = true;
      if (ttlSeconds !== null) opts.expireAfterSeconds = ttlSeconds;
      if (pf) opts.partialFilterExpression = JSON.parse(pf);
      if (coln) opts.collation = JSON.parse(coln);
      if (trimmed) opts.name = trimmed;
      await commandLog.pushTimed(
        createIndexCmd(coll, JSON.parse(keys) as Record<string, unknown>, Object.keys(opts).length ? opts : undefined),
        sessionId,
        () => createIndex(sessionId, db, coll, keys, unique, trimmed, sparse, ttlSeconds, pf, coln),
      );
      await refresh();
    } finally {
      activity.end();
    }
  }

  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  /** Asks (type the index name) before dropping. */
  function requestDrop(name: string) {
    void destructive.request({ op: "dropIndex", target: { db, coll, index: name } }, () => drop(name));
  }

  async function drop(name: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropIndexCmd(coll, name), sessionId, () =>
        dropIndex(sessionId, db, coll, name));
      await refresh();
    } catch (e) {
      guard.setError(errorMessage(e));
    } finally {
      activity.end();
    }
  }

  return {
    get indexes() {
      return indexes;
    },
    get error() {
      return guard.error;
    },
    get loading() {
      return guard.loading;
    },
    init: refresh,
    refresh,
    create,
    drop,
    requestDrop,
    /** The index drop waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
  };
}
