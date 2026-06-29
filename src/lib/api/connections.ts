import { invoke } from "@tauri-apps/api/core";

export interface ConnectionInput {
  label: string;
  scheme: string; // "mongodb" | "mongodb+srv"
  host: string;
  port: number | null;
  authMethod: string; // "none" | "password"
  user: string;
  passwordEnc: string;
  authSource: string;
  replicaSet: string;
  tls: boolean;
  extraOptions: string;
  readOnly: boolean;
}

export interface SavedConnection extends ConnectionInput {
  id: number;
  /** Legacy pre-Phase-E field; present only on un-migrated entries. */
  uri?: string | null;
}

export async function listConnections(): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("list_connections");
}

export async function saveConnection(
  id: number | null,
  input: ConnectionInput,
): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("save_connection", { id, input });
}

export async function deleteConnection(id: number): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("delete_connection", { id });
}
