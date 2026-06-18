import { invoke } from "@tauri-apps/api/core";

export interface SavedConnection {
  id: number;
  label: string;
  uri: string;
}

export async function listConnections(): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("list_connections");
}

export async function saveConnection(
  id: number | null,
  label: string,
  uri: string,
): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("save_connection", { id, label, uri });
}

export async function deleteConnection(id: number): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("delete_connection", { id });
}
