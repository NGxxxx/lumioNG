import { invoke } from "@tauri-apps/api/core";
import type { DbInfo } from "../domain/namespaces";

export interface SshConnectInput {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  authMethod: "password" | "key";
  password: string;
  privateKeyPath: string;
  passphrase: string;
}

export async function connect(
  sessionId: string,
  uri: string,
  readOnly = false,
  ssh: SshConnectInput | null = null,
  label = "",
  environment = "",
): Promise<void> {
  await invoke("connect", { sessionId, uri, readOnly, ssh, label, environment });
}

/** Tells the backend a live session was relabelled (audit log and MCP read the label/environment from Rust). */
export async function setSessionMeta(sessionId: string, label: string, environment: string): Promise<void> {
  await invoke("set_session_meta", { sessionId, label, environment });
}

export async function testConnection(uri: string, ssh: SshConnectInput | null): Promise<void> {
  await invoke("test_connection", { uri, ssh });
}

export async function disconnect(sessionId: string): Promise<void> {
  await invoke("disconnect", { sessionId });
}

export async function forgetSshHostKey(host: string, port: number): Promise<void> {
  await invoke("forget_ssh_host_key", { host, port });
}

export async function listNamespaces(sessionId: string, includeSystemDbs = false): Promise<DbInfo[]> {
  return await invoke<DbInfo[]>("list_namespaces", { sessionId, includeSystemDbs });
}

/** A database's real collections (views and system.* excluded). */
export async function listPlainCollections(sessionId: string, db: string): Promise<string[]> {
  return await invoke<string[]>("list_plain_collections", { sessionId, db });
}
