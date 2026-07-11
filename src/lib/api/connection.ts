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
): Promise<void> {
  await invoke("connect", { sessionId, uri, readOnly, ssh });
}

export async function testConnection(uri: string, ssh: SshConnectInput | null): Promise<void> {
  await invoke("test_connection", { uri, ssh });
}

export async function disconnect(sessionId: string): Promise<void> {
  await invoke("disconnect", { sessionId });
}

export async function listNamespaces(sessionId: string): Promise<DbInfo[]> {
  return await invoke<DbInfo[]>("list_namespaces", { sessionId });
}
