import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CsfleConfig, CsfleView, DataKeyInfo, KmsInput } from "../domain/csfle";

export type { CsfleConfig, CsfleView, DataKeyInfo, KmsInput };

let available: Promise<boolean> | null = null;

/** Whether this build contains CSFLE support (cached: it cannot change while the app runs). */
export function csfleAvailable(): Promise<boolean> {
  available ??= invoke<boolean>("csfle_available").catch(() => false);
  return available;
}

export async function csfleGet(connectionId: number): Promise<CsfleView> {
  return await invoke<CsfleView>("csfle_get", { connectionId });
}

/** Saves the settings; resolves where the credentials ended up (`"keychain"`, `"vault"`, or `""` when none). */
export async function csfleSave(connectionId: number, config: CsfleConfig, kms: KmsInput): Promise<string> {
  return await invoke<string>("csfle_save", { connectionId, config, kms });
}

export async function csfleClear(connectionId: number): Promise<void> {
  await invoke("csfle_clear", { connectionId });
}

/** Writes 96 random bytes to `path` for use as the local master key (refuses to overwrite). */
export async function csfleGenerateLocalKey(path: string): Promise<void> {
  await invoke("csfle_generate_local_key", { path });
}

export async function csfleSessionEnabled(sessionId: string): Promise<boolean> {
  return await invoke<boolean>("csfle_session_enabled", { sessionId });
}

export async function csfleListKeys(sessionId: string): Promise<DataKeyInfo[]> {
  return await invoke<DataKeyInfo[]>("csfle_list_keys", { sessionId });
}

export async function csfleCreateDataKey(sessionId: string, provider: string, altName: string | null, masterKey: string | null): Promise<string> {
  return await invoke<string>("csfle_create_data_key", { sessionId, provider, altName, masterKey });
}

/** Encrypts one value (Canonical Extended JSON in, Canonical Extended JSON of the BinData subtype 6 out). */
export async function csfleEncrypt(
  sessionId: string,
  value: string,
  key: { keyId: string | null; keyAltName: string | null },
  algorithm: "deterministic" | "random",
): Promise<string> {
  return await invoke<string>("csfle_encrypt", { sessionId, value, keyId: key.keyId, keyAltName: key.keyAltName, algorithm });
}

/** BinData subtype 6 paths (dotted) of one stored document, read without decrypting. */
export async function csfleEncryptedPaths(sessionId: string, db: string, coll: string, idJson: string): Promise<string[]> {
  return await invoke<string[]>("csfle_encrypted_paths", { sessionId, db, coll, idJson });
}

export interface DecryptUnavailable {
  sessionId: string;
  /** The libmongocrypt text (already redacted). */
  reason: string;
}

/** Called when a read had to fall back to ciphertext because a field could not be decrypted. Resolves the unsubscribe function. */
export async function onDecryptUnavailable(cb: (e: DecryptUnavailable) => void): Promise<() => void> {
  return await listen<DecryptUnavailable>("csfle-decrypt-unavailable", (ev) => cb(ev.payload));
}

/** Called after a read on an encrypting session decrypted fine (clears the "decryption unavailable" banner). */
export async function onDecryptRestored(cb: (sessionId: string) => void): Promise<() => void> {
  return await listen<{ sessionId: string }>("csfle-decrypt-ok", (ev) => cb(ev.payload.sessionId));
}
