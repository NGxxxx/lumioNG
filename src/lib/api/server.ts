import { invoke } from "@tauri-apps/api/core";

export async function serverStatus(sessionId: string): Promise<string> {
  return await invoke<string>("server_status", { sessionId });
}

export async function buildInfo(sessionId: string): Promise<string> {
  return await invoke<string>("build_info", { sessionId });
}

export async function hostInfo(sessionId: string): Promise<string> {
  return await invoke<string>("host_info", { sessionId });
}
