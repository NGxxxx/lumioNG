import { invoke } from "@tauri-apps/api/core";

export async function listIndexes(db: string, coll: string): Promise<string[]> {
  return await invoke<string[]>("list_indexes", { db, coll });
}

export async function createIndex(
  db: string,
  coll: string,
  keys: string,
  unique: boolean,
  name: string | null,
): Promise<void> {
  await invoke("create_index", { db, coll, keys, unique, name });
}

export async function dropIndex(db: string, coll: string, name: string): Promise<void> {
  await invoke("drop_index", { db, coll, name });
}
