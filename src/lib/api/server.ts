import { invoke } from "@tauri-apps/api/core";

export async function serverStatus(): Promise<string> {
  return await invoke<string>("server_status");
}

export async function buildInfo(): Promise<string> {
  return await invoke<string>("build_info");
}

export async function hostInfo(): Promise<string> {
  return await invoke<string>("host_info");
}
