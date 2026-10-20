import { invoke } from "@tauri-apps/api/core";
import type { DbInfo } from "../domain/namespaces";
import type { DiagStep } from "../domain/connectionDiag";

export type { DiagStep };

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

/** A proxy for the app's own connections. SOCKS5 is applied by the driver from the URI (pass it only for diagnosis); HTTP CONNECT is run by the backend. */
export interface ProxyConnectInput {
  kind: "socks5" | "http";
  host: string;
  port: number;
  user: string;
  password: string;
}

export async function connect(
  sessionId: string,
  uri: string,
  readOnly = false,
  ssh: SshConnectInput | null = null,
  label = "",
  environment = "",
  proxy: ProxyConnectInput | null = null,
  /** Saved connection id: keys the OIDC refresh token, so a later connect can skip the browser. */
  connectionId: number | null = null,
): Promise<void> {
  await invoke("connect", { sessionId, uri, readOnly, ssh, label, environment, proxy, connectionId });
}

/** Tells the backend a live session was relabelled (audit log and MCP read the label/environment from Rust). */
export async function setSessionMeta(sessionId: string, label: string, environment: string): Promise<void> {
  await invoke("set_session_meta", { sessionId, label, environment });
}

export async function testConnection(uri: string, ssh: SshConnectInput | null, proxy: ProxyConnectInput | null = null, connectionId: number | null = null): Promise<void> {
  await invoke("test_connection", { uri, ssh, proxy, connectionId });
}

/** Step-by-step diagnosis of a connection that failed to open (URI, SRV, DNS, TCP, TLS, hello, auth). */
export async function diagnoseConnection(uri: string, ssh: SshConnectInput | null, proxy: ProxyConnectInput | null = null): Promise<DiagStep[]> {
  return await invoke<DiagStep[]>("diagnose_connection", { uri, ssh, proxy });
}

/** One `ping` on a live session; rejects when the server cannot be reached. */
export async function sessionPing(sessionId: string): Promise<void> {
  await invoke("session_ping", { sessionId });
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
