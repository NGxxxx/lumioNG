import { listIndexes, createIndex, dropIndex, indexStats, setIndexHidden } from "../api/indexes";
import { collStats } from "../api/stats";
import { isMaster } from "../api/mongoServer";
import { findById } from "../api/documents";
import { parseCollStats } from "../domain/stats";
import {
  buildIndexRows, dataDays as dataDaysOf, parseIndexStats, parseServerTraits, parseShardKey, unusedSummary,
  type IndexRow, type IndexUsage, type ServerTraits,
} from "../domain/indexUsage";
import { parseIndexList, buildIndexKeys, validateIndexFields, type IndexInfo } from "../domain/indexes";
import { errorMessage } from "../api/errors";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import * as m from "#lib/paraglide/messages.js";
import { createIndexCmd, dropIndexCmd, hideIndexCmd, listIndexesCmd } from "../domain/mongosh";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { createAsyncGuard } from "./asyncGuard.svelte";

/** State and actions for the Indexes tab of a collection; parse/build/validate logic lives in domain. */
export function createIndexView(sessionId: string, db: string, coll: string) {
  let indexes = $state.raw<IndexInfo[]>([]);
  // Usage counters / sizes are extras: their failure (e.g. no $indexStats privilege) never fails the tab.
  let usage = $state.raw<IndexUsage[] | null>(null);
  let usageError = $state<string | null>(null);
  let sizes = $state.raw<Record<string, number>>({});
  let traits = $state.raw<ServerTraits>(parseServerTraits(null));
  let shardKey = $state.raw<string[] | null>(null);
  let now = $state(Date.now());
  /** Index waiting for the light "hide it?" confirmation. */
  let pendingHide = $state<string | null>(null);
  /** Index whose Drop was clicked while hiding would be the safer first step. */
  let dropAdvice = $state<string | null>(null);
  const guard = createAsyncGuard();

  const rows = $derived<IndexRow[]>(buildIndexRows(indexes, usage ?? [], sizes, now, shardKey));

  async function refresh() {
    const gen = guard.begin();
    activity.begin(m.common_running());
    try {
      // One round, in parallel: the list itself plus the extras ($indexStats, sizes, server traits).
      const [raw, stats, cs, hello] = await Promise.allSettled([
        commandLog.pushTimed(listIndexesCmd(coll), sessionId, () => listIndexes(sessionId, db, coll)),
        indexStats(sessionId, db, coll),
        collStats(sessionId, db, coll),
        isMaster(sessionId),
      ]);
      if (!guard.isCurrent(gen)) return;
      if (raw.status === "rejected") throw raw.reason;
      indexes = parseIndexList(raw.value);
      usage = stats.status === "fulfilled" ? parseIndexStats(stats.value) : null;
      usageError = stats.status === "rejected" ? errorMessage(stats.reason) : null;
      const sizeList = cs.status === "fulfilled" ? parseCollStats(cs.value).indexSizes : [];
      sizes = Object.fromEntries(sizeList.filter((x) => x.bytes !== null).map((x) => [x.name, x.bytes as number]));
      traits = parseServerTraits(hello.status === "fulfilled" ? hello.value : null);
      if (traits.topology === "sharded") {
        const cfg = await findById(sessionId, "config", "collections", JSON.stringify(`${db}.${coll}`)).catch(() => null);
        if (!guard.isCurrent(gen)) return;
        shardKey = parseShardKey(cfg);
      } else shardKey = null;
      now = Date.now();
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

  /** Hiding is the reversible first step for an unprotected, visible index (MongoDB 4.4+). */
  function hideable(name: string): boolean {
    const row = rows.find((r) => r.info.name === name);
    return !!row && traits.canHide && !row.info.hidden && !row.status.startsWith("protected");
  }

  /** Asks (type the index name) before dropping; offers "hide it first" when that is possible. */
  function requestDrop(name: string) {
    if (hideable(name)) {
      dropAdvice = name;
      return;
    }
    dropAnyway(name);
  }

  function dropAnyway(name: string = dropAdvice ?? "") {
    dropAdvice = null;
    if (!name) return;
    void destructive.request({ op: "dropIndex", target: { db, coll, index: name } }, () => drop(name));
  }

  async function setHidden(name: string, hidden: boolean) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(hideIndexCmd(coll, name, hidden), sessionId, () =>
        setIndexHidden(sessionId, db, coll, name, hidden));
      await refresh();
    } catch (e) {
      guard.setError(errorMessage(e));
    } finally {
      activity.end();
    }
  }

  function requestHide(name: string) {
    if (hideable(name)) pendingHide = name;
  }

  async function confirmHide() {
    const name = pendingHide;
    pendingHide = null;
    if (name) await setHidden(name, true);
  }

  /** From the drop advice: hide instead (the user already chose to act; hiding is reversible). */
  async function hideInstead() {
    const name = dropAdvice;
    dropAdvice = null;
    if (name) await setHidden(name, true);
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
    get rows() { return rows; },
    get summary() { return unusedSummary(rows); },
    get dataDays() { return usage ? dataDaysOf(usage, now) : null; },
    /** Start of the usage counting window (latest server/shard start); null when unknown. */
    get since() { return usage && usage.length ? Math.max(...usage.map((u) => u.since)) : null; },
    get usageError() { return usageError; },
    get traits() { return traits; },
    get pendingHide() { return pendingHide; },
    get dropAdvice() { return dropAdvice; },
    requestHide,
    confirmHide,
    cancelHide: () => { pendingHide = null; },
    unhide: (name: string) => setHidden(name, false),
    hideInstead,
    dropAnyway: () => dropAnyway(),
    cancelDropAdvice: () => { dropAdvice = null; },
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
