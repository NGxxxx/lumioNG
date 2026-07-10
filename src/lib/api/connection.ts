import { invoke } from "@tauri-apps/api/core";
import type { DbInfo } from "../domain/namespaces";

export async function connect(sessionId: string, uri: string, readOnly = false): Promise<void> {
  await invoke("connect", { sessionId, uri, readOnly });
}

export async function disconnect(sessionId: string): Promise<void> {
  await invoke("disconnect", { sessionId });
}

export async function listNamespaces(sessionId: string): Promise<DbInfo[]> {
  return await invoke<DbInfo[]>("list_namespaces", { sessionId });
}
