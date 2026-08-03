import { invoke } from "@tauri-apps/api/core";

export async function listIndexes(sessionId: string, db: string, coll: string): Promise<string[]> {
  return await invoke<string[]>("list_indexes", { sessionId, db, coll });
}

export async function createIndex(
  sessionId: string,
  db: string,
  coll: string,
  keys: string,
  unique: boolean,
  name: string | null,
  sparse: boolean,
  ttlSeconds: number | null,
  partialFilter: string | null,
  collation: string | null,
): Promise<void> {
  await invoke("create_index", {
    sessionId, db, coll, keys, unique, name, sparse, ttlSeconds, partialFilter, collation,
  });
}

export async function dropIndex(sessionId: string, db: string, coll: string, name: string): Promise<void> {
  await invoke("drop_index", { sessionId, db, coll, name });
}

/** Recreates indexes from their raw `listIndexes` documents (as returned by `listIndexes` above) —
 *  used to restore a collection's indexes from an exported metadata sidecar. */
export async function createIndexesRaw(
  sessionId: string,
  db: string,
  coll: string,
  indexesJson: string,
): Promise<void> {
  await invoke("create_indexes_raw", { sessionId, db, coll, indexesJson });
}
