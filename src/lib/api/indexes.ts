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
): Promise<void> {
  await invoke("create_index", { sessionId, db, coll, keys, unique, name });
}

export async function dropIndex(sessionId: string, db: string, coll: string, name: string): Promise<void> {
  await invoke("drop_index", { sessionId, db, coll, name });
}
