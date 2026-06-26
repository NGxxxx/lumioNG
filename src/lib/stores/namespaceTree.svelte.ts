// State and DDL actions for the namespace sidebar tree (databases + collections).
import { listNamespaces, type DbInfo } from "../api/connection";
import * as admin from "../api/admin";
import { errorMessage } from "../api/errors";
import { validateCollectionName, validateDatabaseName } from "../domain/namespaces";
import { commandLog } from "./commandLog.svelte";
import {
  createCollectionCmd,
  dropCollectionCmd,
  renameCollectionCmd,
  duplicateCollectionCmd,
  dropDatabaseCmd,
  truncateCollectionCmd,
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

  async function refresh() {
    try {
      databases = await listNamespaces(sessionId);
      error = null;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function createCollection(db: string, coll: string) {
    const msg = validateCollectionName(coll);
    if (msg) throw msg;
    await admin.createCollection(sessionId, db, coll);
    commandLog.push(createCollectionCmd(coll), sessionId);
    await refresh();
  }

  async function createDatabase(db: string, coll: string) {
    const dbMsg = validateDatabaseName(db);
    if (dbMsg) throw dbMsg;
    const collMsg = validateCollectionName(coll);
    if (collMsg) throw collMsg;
    await admin.createCollection(sessionId, db, coll);
    commandLog.push(createCollectionCmd(coll), sessionId);
    await refresh();
  }

  async function dropCollection(db: string, coll: string) {
    await admin.dropCollection(sessionId, db, coll);
    commandLog.push(dropCollectionCmd(coll), sessionId);
    nav.closeForCollection(db, coll);
    await refresh();
  }

  async function renameCollection(db: string, from: string, to: string) {
    const msg = validateCollectionName(to);
    if (msg) throw msg;
    await admin.renameCollection(sessionId, db, from, to);
    commandLog.push(renameCollectionCmd(from, to), sessionId);
    nav.renameCollectionTabs(db, from, to);
    await refresh();
  }

  async function duplicateCollection(db: string, source: string, target: string) {
    const msg = validateCollectionName(target);
    if (msg) throw msg;
    await admin.duplicateCollection(sessionId, db, source, target);
    commandLog.push(duplicateCollectionCmd(source, target), sessionId);
    await refresh();
  }

  async function dropDatabase(db: string) {
    await admin.dropDatabase(sessionId, db);
    commandLog.push(dropDatabaseCmd(), sessionId);
    nav.closeForDatabase(db);
    await refresh();
  }

  async function truncate(db: string, coll: string) {
    await admin.truncateCollection(sessionId, db, coll);
    commandLog.push(truncateCollectionCmd(coll), sessionId);
    await refresh();
  }

  /** Drop all cached namespaces (e.g. on disconnect) so the sidebar shows no stale DBs. */
  function clear() {
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
