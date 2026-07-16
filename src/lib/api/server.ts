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

/** One entry per mongod restart, from `local.startup_log` — restart history the current
 *  serverStatus/hostInfo snapshot can't show. Newest first, capped server-side to 20. */
export async function startupLog(sessionId: string): Promise<string[]> {
  return await invoke<string[]>("startup_log", { sessionId });
}

export async function currentOps(sessionId: string): Promise<string> {
  return await invoke<string>("current_ops", { sessionId });
}

export async function killOp(sessionId: string, opid: number): Promise<void> {
  await invoke<void>("kill_op", { sessionId, opid });
}
