import * as api from "../api/csfle";
import { errorMessage } from "../api/errors";
import type { DataKeyInfo } from "../domain/csfle";
import { masterKeyJson } from "../domain/csfle";

export type EncryptAlgorithm = "deterministic" | "random";

/** The "Encrypt with key…" flow of the document editor: pick (or create) a data key and an algorithm, encrypt one value. */
export function createEncryptFlow(sessionId: string) {
  let keys = $state<DataKeyInfo[]>([]);
  let keyId = $state("");
  let algorithm = $state<EncryptAlgorithm>("deterministic");
  let loading = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function loadKeys() {
    loading = true;
    error = null;
    try {
      keys = await api.csfleListKeys(sessionId);
      if (!keys.some((k) => k.id === keyId)) keyId = keys[0]?.id ?? "";
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function createKey(provider: string, altName: string, master: Record<string, string>): Promise<boolean> {
    busy = true;
    error = null;
    try {
      const id = await api.csfleCreateDataKey(sessionId, provider, altName.trim() || null, masterKeyJson(provider, master));
      await loadKeys();
      keyId = id;
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      busy = false;
    }
  }

  /** Encrypts `value` (any JSON-able document value in Extended JSON form). Resolves the encrypted Extended JSON value, or null on failure. */
  async function encrypt(value: unknown): Promise<unknown | null> {
    if (!keyId) return null;
    busy = true;
    error = null;
    try {
      const out = await api.csfleEncrypt(sessionId, JSON.stringify(value), { keyId, keyAltName: null }, algorithm);
      return JSON.parse(out);
    } catch (e) {
      error = errorMessage(e);
      return null;
    } finally {
      busy = false;
    }
  }

  return {
    get keys() { return keys; },
    get keyId() { return keyId; }, set keyId(v: string) { keyId = v; },
    get algorithm() { return algorithm; }, set algorithm(v: EncryptAlgorithm) { algorithm = v; },
    get loading() { return loading; },
    get busy() { return busy; },
    get error() { return error; },
    loadKeys, createKey, encrypt,
  };
}
