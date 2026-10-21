import { atlasHasCredentials, atlasSaveCredentials, atlasForgetCredentials, atlasListProjects, atlasListClusters } from "../api/atlas";
import { errorMessage } from "../api/errors";
import { vaultRefusal } from "../domain/vault";
import { clusterUri, type AtlasCluster, type AtlasProject } from "../domain/atlas";
import { connectionPrefill, type ConnectionPrefill } from "./connectionPrefill";
import { vault } from "./vault.svelte";
import { prefs } from "./prefs.svelte";
import * as m from "#lib/paraglide/messages.js";

/** Non-secret convenience: the last Service Account client ID (the secret lives in the keychain / vault). */
const CLIENT_ID_KEY = "atlas-client-id";

function readClientId(): string {
  return prefs.getItem(CLIENT_ID_KEY) ?? "";
}
function writeClientId(id: string) {
  if (id) prefs.setItem(CLIENT_ID_KEY, id);
  else prefs.removeItem(CLIENT_ID_KEY);
}

/** Atlas Admin API browser: Service Account sign-in, then project -> cluster -> connection string. The secret never leaves the form field. */
export function createAtlasBrowser() {
  let clientId = $state("");
  let secret = $state("");
  let hasSaved = $state(false);
  let projects = $state.raw<AtlasProject[]>([]);
  let projectId = $state("");
  let clusters = $state.raw<AtlasCluster[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  let seq = 0;

  /** Runs `fn`; a locked / missing vault asks for the master password once and retries. */
  async function withVault<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const refusal = vaultRefusal(e);
      if (refusal && refusal !== "vault_seal_failed" && (await vault.ensure(refusal === "vault_uninitialized" ? "setup" : "unlock"))) {
        return await fn();
      }
      if (refusal) throw new Error(m.atlas_vault_refused());
      throw e;
    }
  }

  async function loadProjects() {
    const my = ++seq;
    loading = true;
    error = null;
    try {
      const list = await withVault(() => atlasListProjects(clientId));
      if (my !== seq) return;
      projects = list;
      clusters = [];
      projectId = list.length === 1 ? list[0].id : "";
      if (projectId) await loadClusters();
    } catch (e) {
      if (my === seq) error = errorMessage(e);
    } finally {
      if (my === seq) loading = false;
    }
  }

  async function loadClusters() {
    if (!projectId) return;
    const my = ++seq;
    loading = true;
    error = null;
    try {
      const list = await withVault(() => atlasListClusters(clientId, projectId));
      if (my === seq) clusters = list;
    } catch (e) {
      if (my === seq) error = errorMessage(e);
    } finally {
      if (my === seq) loading = false;
    }
  }

  /** Called when the browser opens: remembers the client id and uses an already stored secret. */
  async function init() {
    clientId = readClientId();
    if (!clientId) return;
    try {
      hasSaved = await atlasHasCredentials(clientId);
    } catch {
      hasSaved = false;
    }
    if (hasSaved) await loadProjects();
  }

  /** Verifies the Service Account, stores the secret (keychain, or the vault when there is none) and lists the projects. */
  async function signIn() {
    const id = clientId.trim();
    const sec = secret;
    if (!id || (!sec && !hasSaved)) return;
    clientId = id;
    loading = true;
    error = null;
    note = null;
    try {
      if (sec) {
        const where = await withVault(() => atlasSaveCredentials(id, sec));
        note = where === "vault" ? m.atlas_stored_vault() : m.atlas_stored_keychain();
        hasSaved = true;
      }
      secret = "";
      writeClientId(id);
    } catch (e) {
      error = errorMessage(e);
      loading = false;
      return;
    }
    loading = false;
    await loadProjects();
  }

  async function signOut() {
    const id = clientId.trim();
    if (id) await atlasForgetCredentials(id).catch(() => {});
    writeClientId("");
    hasSaved = false;
    secret = "";
    projects = [];
    clusters = [];
    projectId = "";
    note = null;
    error = null;
    seq++;
  }

  async function selectProject(id: string) {
    projectId = id;
    clusters = [];
    await loadClusters();
  }

  /** The prefill for the connection form, or null when Atlas published no connection string. */
  function pick(c: AtlasCluster): ConnectionPrefill | null {
    const uri = clusterUri(c);
    if (!uri) return null;
    const p = { uri, label: c.name };
    connectionPrefill.set(p);
    return p;
  }

  return {
    get clientId() { return clientId; },
    set clientId(v: string) { clientId = v; },
    get secret() { return secret; },
    set secret(v: string) { secret = v; },
    get hasSaved() { return hasSaved; },
    get projects() { return projects; },
    get projectId() { return projectId; },
    get clusters() { return clusters; },
    get loading() { return loading; },
    get error() { return error; },
    get note() { return note; },
    init,
    signIn,
    signOut,
    selectProject,
    refresh: loadProjects,
    pick,
  };
}
