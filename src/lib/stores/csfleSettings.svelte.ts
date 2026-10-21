import * as api from "../api/csfle";
import { errorMessage } from "../api/errors";
import {
  buildConfig, buildKmsInput, DEFAULT_KEY_VAULT_NAMESPACE, emptyKmsForm, settingsProblem,
  type KmsForm,
} from "../domain/csfle";

/** State and actions of the "Encryption" tab of a saved connection. Credentials are write-only: they go to the backend and never come back. */
export function createCsfleSettings(connectionId: number | null) {
  let enabled = $state(false);
  let namespace = $state(DEFAULT_KEY_VAULT_NAMESPACE);
  let selected = $state<string[]>([]);
  let stored = $state<string[]>([]);
  let cryptSharedLibPath = $state("");
  let form = $state<KmsForm>(emptyKmsForm());
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  /** Where the credentials were stored by the last save: "keychain" | "vault" | "" (none). */
  let savedTo = $state<string | null>(null);

  const problem = $derived(settingsProblem(enabled, namespace, selected, stored, buildKmsInput(form, selected)));

  async function load() {
    if (connectionId === null) return;
    loading = true;
    error = null;
    try {
      const v = await api.csfleGet(connectionId);
      enabled = v.config.enabled;
      namespace = v.config.keyVaultNamespace;
      selected = [...v.config.providers];
      stored = [...v.storedProviders];
      cryptSharedLibPath = v.config.cryptSharedLibPath;
      form = emptyKmsForm();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  function toggleProvider(name: string, on: boolean) {
    selected = on ? (selected.includes(name) ? selected : [...selected, name]) : selected.filter((p) => p !== name);
  }

  /** Returns true when saved. */
  async function save(): Promise<boolean> {
    if (connectionId === null || problem !== null) return false;
    saving = true;
    error = null;
    try {
      const where = await api.csfleSave(connectionId, buildConfig(enabled, namespace, selected, cryptSharedLibPath), buildKmsInput(form, selected));
      savedTo = where;
      await load();
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      saving = false;
    }
  }

  async function generateLocalKey(path: string): Promise<boolean> {
    error = null;
    try {
      await api.csfleGenerateLocalKey(path);
      form.localKeyFile = path;
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    }
  }

  return {
    get connectionId() { return connectionId; },
    get enabled() { return enabled; }, set enabled(v: boolean) { enabled = v; },
    get namespace() { return namespace; }, set namespace(v: string) { namespace = v; },
    get cryptSharedLibPath() { return cryptSharedLibPath; }, set cryptSharedLibPath(v: string) { cryptSharedLibPath = v; },
    get form() { return form; },
    get selected() { return selected; },
    get stored() { return stored; },
    get loading() { return loading; },
    get saving() { return saving; },
    get error() { return error; },
    get savedTo() { return savedTo; },
    get problem() { return problem; },
    load, toggleProvider, save, generateLocalKey,
  };
}
