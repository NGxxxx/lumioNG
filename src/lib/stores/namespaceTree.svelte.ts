// State and DDL actions for the namespace sidebar tree (databases + collections).
import { listNamespaces } from "../api/connection";
import type { DbInfo } from "../domain/namespaces";
import * as admin from "../api/admin";
import { errorMessage } from "../api/errors";
import { validateCollectionName, validateDatabaseName } from "../domain/namespaces";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { settings } from "./settings.svelte";
import * as m from "$lib/paraglide/messages";
import {
  createCollectionCmd,
  dropCollectionCmd,
  renameCollectionCmd,
  duplicateCollectionCmd,
  dropDatabaseCmd,
  truncateCollectionCmd,
  listDatabasesCmd,
} from "../domain/mongosh";

export type NavLike = {
  closeForCollection(db: string, coll: string): void;
  closeForDatabase(db: string): void;
  renameCollectionTabs(db: string, oldColl: string, newColl: string): void;
};

/** No-op nav for the kept singleton (which never drives a real session's tabs). */
const defaultNav: NavLike = {
  closeForCollection() {},
  closeForDatabase() {},
  renameCollectionTabs() {},
};

export function createNamespaceTree(sessionId: string, nav: NavLike = defaultNav) {
  let databases = $state<DbInfo[]>([]);
  let error = $state<string | null>(null);
  /** Bumped on every refresh() call so a slower, superseded call can't overwrite fresher state. */
  let generation = 0;

  async function refresh() {
    const gen = ++generation;
    activity.begin(m.common_running());
    try {
      const list = await commandLog.pushTimed(listDatabasesCmd(), sessionId, () =>
        listNamespaces(sessionId, settings.showSystemDatabases));
      if (gen !== generation) return;
      databases = list;
      error = null;
    } catch (e) {
      if (gen !== generation) return;
      error = errorMessage(e);
    } finally {
      activity.end();
    }
  }

  async function createCollection(db: string, coll: string) {
    const msg = validateCollectionName(coll);
    if (msg) throw msg;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(createCollectionCmd(coll), sessionId, () =>
        admin.createCollection(sessionId, db, coll));
      await refresh();
    } finally {
      activity.end();
    }
  }

  /** A database only exists once it has a first collection. */
  async function createDatabase(db: string, coll: string) {
    const dbMsg = validateDatabaseName(db);
    if (dbMsg) throw dbMsg;
    await createCollection(db, coll);
  }

  async function dropCollection(db: string, coll: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropCollectionCmd(coll), sessionId, () =>
        admin.dropCollection(sessionId, db, coll));
      nav.closeForCollection(db, coll);
      await refresh();
    } finally {
      activity.end();
    }
  }

  async function renameCollection(db: string, from: string, to: string) {
    const msg = validateCollectionName(to);
    if (msg) throw msg;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(renameCollectionCmd(from, to), sessionId, () =>
        admin.renameCollection(sessionId, db, from, to));
      nav.renameCollectionTabs(db, from, to);
      await refresh();
    } finally {
      activity.end();
    }
  }

  async function duplicateCollection(db: string, source: string, target: string) {
    const msg = validateCollectionName(target);
    if (msg) throw msg;
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(duplicateCollectionCmd(source, target), sessionId, () =>
        admin.duplicateCollection(sessionId, db, source, target));
      await refresh();
    } finally {
      activity.end();
    }
  }

  async function dropDatabase(db: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(dropDatabaseCmd(), sessionId, () =>
        admin.dropDatabase(sessionId, db));
      nav.closeForDatabase(db);
      await refresh();
    } finally {
      activity.end();
    }
  }

  async function truncate(db: string, coll: string) {
    activity.begin(m.common_running());
    try {
      await commandLog.pushTimed(truncateCollectionCmd(coll), sessionId, () =>
        admin.truncateCollection(sessionId, db, coll));
      await refresh();
    } finally {
      activity.end();
    }
  }

  /** Drop all cached namespaces (e.g. on disconnect) so the sidebar shows no stale DBs. */
  function clear() {
    generation++; // an in-flight refresh must not repopulate the sidebar after a disconnect
    databases = [];
    error = null;
  }

  return {
    get databases() {
      return databases;
    },
    get error() {
      return error;
    },
    refresh,
    createDatabase,
    createCollection,
    dropCollection,
    renameCollection,
    duplicateCollection,
    dropDatabase,
    truncate,
    clear,
  };
}

/** Singleton used by not-yet-migrated modules (tests create their own via createNamespaceTree). */
export const namespaceTree = createNamespaceTree("");
