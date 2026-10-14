// Frontend wrappers for commands/server.rs. Not named `server.ts`: SvelteKit 3 treats any `server.*` module as server-only and refuses to bundle it for the browser.
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

export async function isMaster(sessionId: string): Promise<string> {
  return await invoke<string>("is_master", { sessionId });
}

export async function replSetStatus(sessionId: string): Promise<string> {
  return await invoke<string>("repl_set_status", { sessionId });
}

export async function listShards(sessionId: string): Promise<string> {
  return await invoke<string>("list_shards", { sessionId });
}

export async function balancerStatus(sessionId: string): Promise<string> {
  return await invoke<string>("balancer_status", { sessionId });
}
