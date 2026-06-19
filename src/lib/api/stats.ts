import { invoke } from "@tauri-apps/api/core";

export async function collStats(db: string, coll: string): Promise<string> {
  return await invoke<string>("coll_stats", { db, coll });
}

export async function dbStats(db: string): Promise<string> {
  return await invoke<string>("db_stats", { db });
}

export async function collOptions(db: string, coll: string): Promise<string> {
  return await invoke<string>("coll_options", { db, coll });
}
