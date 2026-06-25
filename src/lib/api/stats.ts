import { invoke } from "@tauri-apps/api/core";

export async function collStats(sessionId: string, db: string, coll: string): Promise<string> {
  return await invoke<string>("coll_stats", { sessionId, db, coll });
}

export async function dbStats(sessionId: string, db: string): Promise<string> {
  return await invoke<string>("db_stats", { sessionId, db });
}

export async function collOptions(sessionId: string, db: string, coll: string): Promise<string> {
  return await invoke<string>("coll_options", { sessionId, db, coll });
}
