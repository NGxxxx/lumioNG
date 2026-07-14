import { invoke } from "@tauri-apps/api/core";
import type { QueryNode } from "../domain/queryTree";

export async function loadQueryLibrary(): Promise<QueryNode[]> {
  return await invoke<QueryNode[]>("load_query_library");
}

export async function saveQueryLibrary(nodes: QueryNode[]): Promise<void> {
  await invoke("save_query_library", { nodes });
}
