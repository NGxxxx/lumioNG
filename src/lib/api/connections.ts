import { invoke } from "@tauri-apps/api/core";
import type { Environment } from "../domain/environment";

export interface ConnectionInput {
  label: string;
  scheme: string; // "mongodb" | "mongodb+srv"
  host: string;
  port: number | null;
  authMethod: string; // "none" | "password" | "x509" | "ldap"
  user: string;
  passwordEnc: string;
  authSource: string;
  replicaSet: string;
  tls: boolean;
  extraOptions: string;
  readOnly: boolean;
  tlsCertificateKeyFile: string;
  tlsCertificateKeyFilePasswordEnc: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshAuthMethod: string; // "password" | "key"
  sshPasswordEnc: string;
  sshPrivateKeyPath: string;
  sshPassphraseEnc: string;
  /** "" when unset; files saved before this field existed load as "". */
  environment: Environment;
  /** Hex session color; "" = assigned automatically. */
  color: string;
}

export interface SavedConnection extends ConnectionInput {
  id: number;
  /** Legacy pre-Phase-E field; present only on un-migrated entries. */
  uri?: string | null;
  /** Epoch millis of the last successful connect; null/undefined if never connected. */
  lastConnectedAt?: number | null;
  /** Its secrets live in the OS credential store rather than connections.json. */
  secretsInKeychain?: boolean;
}

/** Where saved passwords go: the OS credential store, or (none available) the connections file. */
export type SecretStorage = "keychain" | "file";

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

export async function touchConnection(id: number): Promise<SavedConnection[]> {
  return await invoke<SavedConnection[]>("touch_connection", { id });
}

export async function getSecretStorage(): Promise<SecretStorage> {
  return await invoke<SecretStorage>("secret_storage");
}
