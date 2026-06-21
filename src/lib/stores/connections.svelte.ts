// src/lib/stores/connections.svelte.ts
import {
  listConnections,
  saveConnection,
  deleteConnection,
  type SavedConnection,
  type ConnectionInput,
} from "../api/connections";
import { connect } from "../api/connection";
import { errorMessage } from "../api/errors";
import { validateProfile } from "../domain/connections";
import { buildProfileUri, parseUri, type ConnectionProfile } from "../domain/connuri";
import { obfuscate, deobfuscate } from "../domain/secret";
import { maskUri } from "../domain/uri";
import { commandLog } from "./commandLog.svelte";
import { connectCmd } from "../domain/mongosh";

/** Registry of saved connections + the structured add/edit form + connect. Components only bind. */
export function createConnectionRegistry() {
  let list = $state<SavedConnection[]>([]);
  let error = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let editingId = $state<number | null>(null);
  let connecting = $state(false);

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

  function profile(): ConnectionProfile {
    return { scheme, host, port, authMethod, user, authSource, replicaSet, tls, extraOptions };
  }

  function toInput(): ConnectionInput {
    return {
      label: label.trim(),
      scheme, host, port, authMethod, user,
      passwordEnc: authMethod === "password" ? obfuscate(password) : "",
      authSource, replicaSet, tls, extraOptions,
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
    tls = false; extraOptions = "";
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
    formError = null;
  }

  function importFromUri(uri: string) {
    const { profile: p, password: pw } = parseUri(uri);
    loadProfile(p);
    password = pw;
  }

  async function connectTo(): Promise<boolean> {
    connecting = true;
    error = null;
    try {
      const uri = currentUri();
      await connect(uri);
      commandLog.push(connectCmd(maskUri(uri)));
      return true;
    } catch (e) {
      error = errorMessage(e);
      return false;
    } finally {
      connecting = false;
    }
  }

  return {
    get list() { return list; },
    get error() { return error; },
    get formError() { return formError; },
    get editingId() { return editingId; },
    get connecting() { return connecting; },
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
    load, save, remove, edit, clearForm, connectTo, importFromUri, currentUri,
  };
}
