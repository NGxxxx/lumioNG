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

export async function currentOps(sessionId: string): Promise<string> {
  return await invoke<string>("current_ops", { sessionId });
}

export async function killOp(sessionId: string, opid: number): Promise<void> {
  await invoke<void>("kill_op", { sessionId, opid });
}
