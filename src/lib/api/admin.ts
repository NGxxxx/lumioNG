import { invoke } from "@tauri-apps/api/core";

export async function createCollection(db: string, coll: string): Promise<void> {
  await invoke("create_collection", { db, coll });
}

export async function dropCollection(db: string, coll: string): Promise<void> {
  await invoke("drop_collection", { db, coll });
}

export async function renameCollection(db: string, from: string, to: string): Promise<void> {
  await invoke("rename_collection", { db, from, to });
}

export async function dropDatabase(db: string): Promise<void> {
  await invoke("drop_database", { db });
}
