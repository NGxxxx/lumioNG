import { listNamespaces, type DbInfo } from "../api/connection";
import * as admin from "../api/admin";
import { errorMessage } from "../api/errors";
import { validateCollectionName, validateDatabaseName } from "../domain/namespaces";
import { workspace as defaultWorkspace } from "./workspace.svelte";

type WorkspaceLike = {
  closeForCollection(db: string, coll: string): void;
  closeForDatabase(db: string): void;
  renameCollectionTabs(db: string, oldColl: string, newColl: string): void;
};

export function createNamespaceTree(workspace: WorkspaceLike = defaultWorkspace) {
  let databases = $state<DbInfo[]>([]);
  let error = $state<string | null>(null);

  async function refresh() {
    try {
      databases = await listNamespaces();
      error = null;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function createCollection(db: string, coll: string) {
    const msg = validateCollectionName(coll);
    if (msg) throw msg;
    await admin.createCollection(db, coll);
    await refresh();
  }

  async function createDatabase(db: string, coll: string) {
    const dbMsg = validateDatabaseName(db);
    if (dbMsg) throw dbMsg;
    const collMsg = validateCollectionName(coll);
    if (collMsg) throw collMsg;
    await admin.createCollection(db, coll);
    await refresh();
  }

  async function dropCollection(db: string, coll: string) {
    await admin.dropCollection(db, coll);
    workspace.closeForCollection(db, coll);
    await refresh();
  }

  async function renameCollection(db: string, from: string, to: string) {
    const msg = validateCollectionName(to);
    if (msg) throw msg;
    await admin.renameCollection(db, from, to);
    workspace.renameCollectionTabs(db, from, to);
    await refresh();
  }

  async function dropDatabase(db: string) {
    await admin.dropDatabase(db);
    workspace.closeForDatabase(db);
    await refresh();
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
    dropDatabase,
  };
}

/** Singleton dùng trong app (test tự tạo instance riêng qua createNamespaceTree). */
export const namespaceTree = createNamespaceTree();
