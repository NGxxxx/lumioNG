import { invoke } from "@tauri-apps/api/core";

export interface DbInfo {
  name: string;
  collections: string[];
}

export async function connect(uri: string): Promise<void> {
  await invoke("connect", { uri });
}

export async function listNamespaces(): Promise<DbInfo[]> {
  return await invoke<DbInfo[]>("list_namespaces");
}
