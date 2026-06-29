// src/lib/stores/connections.svelte.ts
import {
  listConnections,
  saveConnection,
  deleteConnection,
  type SavedConnection,
  type ConnectionInput,
} from "../api/connections";
import { errorMessage } from "../api/errors";
import { validateProfile } from "../domain/connections";
import { buildProfileUri, parseUri, type ConnectionProfile } from "../domain/connuri";
import { obfuscate, deobfuscate } from "../domain/secret";


/** Registry of saved connections + the structured add/edit form + connect. Components only bind. */
export function createConnectionRegistry() {
  let list = $state<SavedConnection[]>([]);
  let error = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let editingId = $state<number | null>(null);

  // form fields
  let label = $state("");
  let scheme = $state<"mongodb" | "mongodb+srv">("mongodb");
  let host = $state("localhost");
  let port = $state<number | null>(27017);
  let authMethod = $state<"none" | "password">("none");
  let user = $state("");
  let password = $state("");
  let authSource = $state("");
  let replicaSet = $state("");
  let tls = $state(false);
  let extraOptions = $state("");
  let readOnly = $state(false);

  function profile(): ConnectionProfile {
    return { scheme, host, port, authMethod, user, authSource, replicaSet, tls, extraOptions };
  }

  function toInput(): ConnectionInput {
    return {
      label: label.trim(),
      scheme, host, port, authMethod, user,
      passwordEnc: authMethod === "password" ? obfuscate(password) : "",
      authSource, replicaSet, tls, extraOptions, readOnly,
    };
  }

  function loadProfile(p: ConnectionProfile) {
    scheme = p.scheme; host = p.host; port = p.port; authMethod = p.authMethod;
    user = p.user; authSource = p.authSource; replicaSet = p.replicaSet;
    tls = p.tls; extraOptions = p.extraOptions;
  }

  function currentUri(): string {
    return buildProfileUri(profile(), password);
  }

  async function load() {
    error = null;
    try {
      const fetched = await listConnections();
      // Lazy migration: legacy entries carry a raw `uri` and no structured host.
      let result = fetched;
      for (const c of fetched) {
        if (c.uri && c.host === "") {
          const { profile: p, password: pw } = parseUri(c.uri);
          const input: ConnectionInput = {
            label: c.label,
            scheme: p.scheme, host: p.host, port: p.port, authMethod: p.authMethod,
            user: p.user, passwordEnc: p.authMethod === "password" ? obfuscate(pw) : "",
            authSource: p.authSource, replicaSet: p.replicaSet, tls: p.tls, extraOptions: p.extraOptions,
            readOnly: false,
          };
          result = await saveConnection(c.id, input);
        }
      }
      list = result;
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function clearForm() {
    editingId = null;
    label = ""; scheme = "mongodb"; host = "localhost"; port = 27017;
    authMethod = "none"; user = ""; password = ""; authSource = ""; replicaSet = "";
    tls = false; extraOptions = ""; readOnly = false;
    formError = null;
  }

  async function save() {
    const v = validateProfile(label, profile());
    if (!v.ok) { formError = v.error; return; }
    formError = null;
    try {
      list = await saveConnection(editingId, toInput());
      clearForm();
    } catch (e) {
      error = errorMessage(e);
    }
  }

  async function remove(id: number) {
    try {
      list = await deleteConnection(id);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  function edit(c: SavedConnection) {
    editingId = c.id;
    label = c.label;
    loadProfile({
      scheme: (c.scheme as ConnectionProfile["scheme"]) || "mongodb",
      host: c.host, port: c.port,
      authMethod: (c.authMethod as ConnectionProfile["authMethod"]) || "none",
      user: c.user, authSource: c.authSource, replicaSet: c.replicaSet,
      tls: c.tls, extraOptions: c.extraOptions,
    });
    password = c.passwordEnc ? deobfuscate(c.passwordEnc) : "";
    readOnly = !!c.readOnly;
    formError = null;
  }

  function importFromUri(uri: string) {
    const { profile: p, password: pw } = parseUri(uri);
    loadProfile(p);
    password = pw;
  }

  /** Build and validate the URI. Returns `{ ok: true, uri }` or `{ ok: false }` (sets `error`). */
  function connectTo(): { ok: true; uri: string } | { ok: false } {
    error = null;
    const uri = currentUri();
    // Minimal sanity check: scheme and host must be present (buildProfileUri already did this).
    if (!host.trim()) {
      error = "Host is required.";
      return { ok: false };
    }
    return { ok: true, uri };
  }

  return {
    get list() { return list; },
    get error() { return error; },
    get formError() { return formError; },
    get editingId() { return editingId; },
    get label() { return label; }, set label(v: string) { label = v; },
    // scheme/authMethod setters accept `string` so `bind:value` on a <select> type-checks cleanly.
    get scheme() { return scheme; }, set scheme(v: string) { scheme = v as "mongodb" | "mongodb+srv"; },
    get host() { return host; }, set host(v: string) { host = v; },
    get port() { return port; }, set port(v: number | null) { port = v; },
    get authMethod() { return authMethod; }, set authMethod(v: string) { authMethod = v as "none" | "password"; },
    get user() { return user; }, set user(v: string) { user = v; },
    get password() { return password; }, set password(v: string) { password = v; },
    get authSource() { return authSource; }, set authSource(v: string) { authSource = v; },
    get replicaSet() { return replicaSet; }, set replicaSet(v: string) { replicaSet = v; },
    get tls() { return tls; }, set tls(v: boolean) { tls = v; },
    get extraOptions() { return extraOptions; }, set extraOptions(v: string) { extraOptions = v; },
    get readOnly() { return readOnly; }, set readOnly(v: boolean) { readOnly = v; },
    load, save, remove, edit, clearForm, connectTo, importFromUri, currentUri,
  };
}
