// src/lib/stores/connections.svelte.ts
import {
  listConnections,
  saveConnection,
  deleteConnection,
  type SavedConnection,
  type ConnectionInput,
} from "../api/connections";
import { testConnection as apiTestConnection, type SshConnectInput } from "../api/connection";
import { errorMessage } from "../api/errors";
import { validateProfile, validateSsh } from "../domain/connections";
import { buildProfileUri, parseUri, normalizeForTunnel, suggestLabelFromHost, changedFieldCount, type ConnectionProfile } from "../domain/connuri";
import { obfuscate, deobfuscate } from "../domain/secret";
import { sortByRecency } from "../domain/recency";
import type { Environment } from "../domain/environment";


/** Registry of saved connections + the structured add/edit form + connect. Components only bind. */
export function createConnectionRegistry() {
  let list = $state<SavedConnection[]>([]);
  const sortedList = $derived(sortByRecency(list));
  let error = $state<string | null>(null);
  let formError = $state<string | null>(null);
  let editingId = $state<number | null>(null);
  // Form values before the last paste-to-fill, so it can be undone.
  let beforeFill = $state.raw<{ label: string; profile: ConnectionProfile; password: string; certKeyPassword: string } | null>(null);

  // form fields
  let label = $state("");
  let scheme = $state<"mongodb" | "mongodb+srv">("mongodb");
  let host = $state("localhost");
  let port = $state<number | null>(27017);
  let authMethod = $state<"none" | "password" | "x509" | "ldap">("none");
  let user = $state("");
  let password = $state("");
  let authSource = $state("");
  let replicaSet = $state("");
  let tls = $state(false);
  let extraOptions = $state("");
  let readOnly = $state(false);
  let environment = $state<Environment>("");
  let color = $state("");
  let tlsCertificateKeyFile = $state("");
  let tlsCertificateKeyFilePassword = $state("");

  // SSH tunnel form fields
  let sshEnabled = $state(false);
  let sshHost = $state("");
  let sshPort = $state<number | null>(22);
  let sshUser = $state("");
  let sshAuthMethod = $state<"password" | "key">("password");
  let sshPassword = $state("");
  let sshPrivateKeyPath = $state("");
  let sshPassphrase = $state("");

  function profile(): ConnectionProfile {
    return {
      scheme, host, port, authMethod, user, authSource, replicaSet, tls, extraOptions,
      tlsCertificateKeyFile,
    };
  }

  function sshConnectInput(): SshConnectInput | null {
    if (!sshEnabled) return null;
    return {
      enabled: true, host: sshHost, port: sshPort ?? 22, user: sshUser, authMethod: sshAuthMethod,
      password: sshAuthMethod === "password" ? sshPassword : "",
      privateKeyPath: sshAuthMethod === "key" ? sshPrivateKeyPath : "",
      passphrase: sshAuthMethod === "key" ? sshPassphrase : "",
    };
  }

  function toInput(): ConnectionInput {
    const p = normalizeForTunnel(profile(), sshEnabled);
    return {
      label: label.trim(),
      scheme: p.scheme, host, port, authMethod, user,
      passwordEnc: authMethod === "password" || authMethod === "ldap" ? obfuscate(password) : "",
      authSource, replicaSet: p.replicaSet, tls, extraOptions, readOnly,
      tlsCertificateKeyFile,
      tlsCertificateKeyFilePasswordEnc: authMethod === "x509" ? obfuscate(tlsCertificateKeyFilePassword) : "",
      sshEnabled, sshHost, sshPort: sshPort ?? 22, sshUser, sshAuthMethod,
      sshPasswordEnc: sshAuthMethod === "password" ? obfuscate(sshPassword) : "",
      sshPrivateKeyPath: sshAuthMethod === "key" ? sshPrivateKeyPath : "",
      sshPassphraseEnc: sshAuthMethod === "key" ? obfuscate(sshPassphrase) : "",
      environment, color,
    };
  }

  function loadProfile(p: ConnectionProfile) {
    scheme = p.scheme; host = p.host; port = p.port; authMethod = p.authMethod;
    user = p.user; authSource = p.authSource; replicaSet = p.replicaSet;
    tls = p.tls; extraOptions = p.extraOptions; tlsCertificateKeyFile = p.tlsCertificateKeyFile;
  }

  function currentUri(): string {
    return buildProfileUri(normalizeForTunnel(profile(), sshEnabled), password, tlsCertificateKeyFilePassword);
  }

  async function load() {
    error = null;
    try {
      const fetched = await listConnections();
      // Lazy migration: legacy entries carry a raw `uri` and no structured host.
      let result = fetched;
      for (const c of fetched) {
        if (c.uri && c.host === "") {
          const { profile: p, password: pw, certKeyPassword } = parseUri(c.uri);
          const input: ConnectionInput = {
            label: c.label,
            scheme: p.scheme, host: p.host, port: p.port, authMethod: p.authMethod,
            user: p.user, passwordEnc: p.authMethod === "password" || p.authMethod === "ldap" ? obfuscate(pw) : "",
            authSource: p.authSource, replicaSet: p.replicaSet, tls: p.tls, extraOptions: p.extraOptions,
            readOnly: false,
            tlsCertificateKeyFile: p.tlsCertificateKeyFile,
            tlsCertificateKeyFilePasswordEnc: obfuscate(certKeyPassword),
            sshEnabled: false, sshHost: "", sshPort: 22, sshUser: "", sshAuthMethod: "password",
            sshPasswordEnc: "", sshPrivateKeyPath: "", sshPassphraseEnc: "",
            environment: "", color: "",
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
    tls = false; extraOptions = ""; readOnly = false; environment = ""; color = "";
    tlsCertificateKeyFile = ""; tlsCertificateKeyFilePassword = "";
    sshEnabled = false; sshHost = ""; sshPort = 22; sshUser = "";
    sshAuthMethod = "password"; sshPassword = ""; sshPrivateKeyPath = ""; sshPassphrase = "";
    formError = null;
    beforeFill = null;
  }

  async function save() {
    const vProfile = validateProfile(label, profile());
    if (!vProfile.ok) { formError = vProfile.error; return; }
    const vSsh = validateSsh({
      enabled: sshEnabled, host: sshHost, port: sshPort, user: sshUser,
      authMethod: sshAuthMethod, privateKeyPath: sshPrivateKeyPath,
    });
    if (!vSsh.ok) { formError = vSsh.error; return; }
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
    beforeFill = null;
    label = c.label;
    loadProfile({
      scheme: (c.scheme as ConnectionProfile["scheme"]) || "mongodb",
      host: c.host, port: c.port,
      authMethod: (c.authMethod as ConnectionProfile["authMethod"]) || "none",
      user: c.user, authSource: c.authSource, replicaSet: c.replicaSet,
      tls: c.tls, extraOptions: c.extraOptions,
      tlsCertificateKeyFile: c.tlsCertificateKeyFile ?? "",
    });
    password = c.passwordEnc ? deobfuscate(c.passwordEnc) : "";
    tlsCertificateKeyFilePassword = c.tlsCertificateKeyFilePasswordEnc ? deobfuscate(c.tlsCertificateKeyFilePasswordEnc) : "";
    readOnly = !!c.readOnly;
    environment = c.environment ?? "";
    color = c.color ?? "";
    sshEnabled = !!c.sshEnabled;
    sshHost = c.sshHost ?? "";
    sshPort = c.sshPort ?? 22;
    sshUser = c.sshUser ?? "";
    sshAuthMethod = (c.sshAuthMethod as "password" | "key") || "password";
    sshPassword = c.sshPasswordEnc ? deobfuscate(c.sshPasswordEnc) : "";
    sshPrivateKeyPath = c.sshPrivateKeyPath ?? "";
    sshPassphrase = c.sshPassphraseEnc ? deobfuscate(c.sshPassphraseEnc) : "";
    formError = null;
  }

  /** Fills the form from a mongodb:// / mongodb+srv:// URI; an invalid one leaves the form untouched. */
  function fillFromUri(uri: string): { ok: true; filled: number } | { ok: false } {
    const text = uri.trim();
    if (!/^mongodb(\+srv)?:\/\//i.test(text)) return { ok: false };
    const parsed = parseUri(text);
    if (!parsed.profile.host) return { ok: false };
    const before = { label, profile: profile(), password, certKeyPassword: tlsCertificateKeyFilePassword };
    loadProfile(parsed.profile);
    password = parsed.password;
    tlsCertificateKeyFilePassword = parsed.certKeyPassword;
    let filled = changedFieldCount(before.profile, parsed.profile) + (password !== before.password ? 1 : 0);
    if (!label.trim()) {
      label = suggestLabelFromHost(parsed.profile.host);
      filled++;
    }
    beforeFill = before;
    return { ok: true, filled };
  }

  function undoFill() {
    const b = beforeFill;
    if (!b) return;
    label = b.label;
    loadProfile(b.profile);
    password = b.password;
    tlsCertificateKeyFilePassword = b.certKeyPassword;
    beforeFill = null;
  }

  /** URI of a saved connection; the password only when asked for. */
  function uriOf(c: SavedConnection, includePassword: boolean): string {
    const p: ConnectionProfile = {
      scheme: (c.scheme as ConnectionProfile["scheme"]) || "mongodb",
      host: c.host, port: c.port,
      authMethod: (c.authMethod as ConnectionProfile["authMethod"]) || "none",
      user: c.user, authSource: c.authSource, replicaSet: c.replicaSet,
      tls: c.tls, extraOptions: c.extraOptions, tlsCertificateKeyFile: c.tlsCertificateKeyFile ?? "",
    };
    const pw = includePassword && c.passwordEnc ? deobfuscate(c.passwordEnc) : "";
    return buildProfileUri(normalizeForTunnel(p, !!c.sshEnabled), pw);
  }

  /** URI of what the form currently shows; the password only when asked for. */
  function formUri(includePassword: boolean): string {
    return buildProfileUri(normalizeForTunnel(profile(), sshEnabled), includePassword ? password : "");
  }

  function importFromUri(uri: string) {
    const { profile: p, password: pw, certKeyPassword } = parseUri(uri);
    loadProfile(p);
    password = pw;
    tlsCertificateKeyFilePassword = certKeyPassword;
  }

  /** Validates host/port/auth/SSH fields for connecting (not saving) — deliberately skips the
   *  label-required check `validateProfile` also does, since ad-hoc connections have no label. */
  function validateConnectFields(): string | null {
    const vProfile = validateProfile(label.trim() || "untitled", profile());
    if (!vProfile.ok) return vProfile.error;
    const vSsh = validateSsh({
      enabled: sshEnabled, host: sshHost, port: sshPort, user: sshUser,
      authMethod: sshAuthMethod, privateKeyPath: sshPrivateKeyPath,
    });
    if (!vSsh.ok) return vSsh.error;
    return null;
  }

  /** Build and validate the URI. Returns `{ ok: true, uri, ssh }` or `{ ok: false }` (sets `error`). */
  function connectTo(): { ok: true; uri: string; ssh: SshConnectInput | null } | { ok: false } {
    error = null;
    const validationError = validateConnectFields();
    if (validationError) {
      error = validationError;
      return { ok: false };
    }
    return { ok: true, uri: currentUri(), ssh: sshConnectInput() };
  }

  /** Validates the current form's connection (SSH tunnel + Mongo) without opening a session. */
  async function testConnection(): Promise<
    { ok: true } | { ok: false; kind: "ssh" | "mongo" | "validation"; message: string }
  > {
    const validationError = validateConnectFields();
    if (validationError) {
      return { ok: false, kind: "validation", message: validationError };
    }
    try {
      await apiTestConnection(currentUri(), sshConnectInput());
      return { ok: true };
    } catch (e) {
      const shape = e as { kind?: string; message?: string };
      const kind = shape.kind === "SshTunnel" ? "ssh" : "mongo";
      return { ok: false, kind, message: shape.message ?? errorMessage(e) };
    }
  }

  return {
    get list() { return sortedList; },
    get error() { return error; },
    get formError() { return formError; },
    get editingId() { return editingId; },
    get label() { return label; }, set label(v: string) { label = v; },
    // scheme/authMethod setters accept `string` so `bind:value` on a <select> type-checks cleanly.
    get scheme() { return scheme; }, set scheme(v: string) { scheme = v as "mongodb" | "mongodb+srv"; },
    get host() { return host; }, set host(v: string) { host = v; },
    get port() { return port; }, set port(v: number | null) { port = v; },
    get authMethod() { return authMethod; }, set authMethod(v: string) { authMethod = v as ConnectionProfile["authMethod"]; },
    get user() { return user; }, set user(v: string) { user = v; },
    get password() { return password; }, set password(v: string) { password = v; },
    get authSource() { return authSource; }, set authSource(v: string) { authSource = v; },
    get replicaSet() { return replicaSet; }, set replicaSet(v: string) { replicaSet = v; },
    get tls() { return tls; }, set tls(v: boolean) { tls = v; },
    get extraOptions() { return extraOptions; }, set extraOptions(v: string) { extraOptions = v; },
    get readOnly() { return readOnly; }, set readOnly(v: boolean) { readOnly = v; },
    get environment() { return environment; }, set environment(v: Environment) { environment = v; },
    get color() { return color; }, set color(v: string) { color = v; },
    get tlsCertificateKeyFile() { return tlsCertificateKeyFile; }, set tlsCertificateKeyFile(v: string) { tlsCertificateKeyFile = v; },
    get tlsCertificateKeyFilePassword() { return tlsCertificateKeyFilePassword; }, set tlsCertificateKeyFilePassword(v: string) { tlsCertificateKeyFilePassword = v; },
    get sshEnabled() { return sshEnabled; }, set sshEnabled(v: boolean) { sshEnabled = v; },
    get sshHost() { return sshHost; }, set sshHost(v: string) { sshHost = v; },
    get sshPort() { return sshPort; }, set sshPort(v: number | null) { sshPort = v; },
    get sshUser() { return sshUser; }, set sshUser(v: string) { sshUser = v; },
    get sshAuthMethod() { return sshAuthMethod; }, set sshAuthMethod(v: string) { sshAuthMethod = v as "password" | "key"; },
    get sshPassword() { return sshPassword; }, set sshPassword(v: string) { sshPassword = v; },
    get sshPrivateKeyPath() { return sshPrivateKeyPath; }, set sshPrivateKeyPath(v: string) { sshPrivateKeyPath = v; },
    get sshPassphrase() { return sshPassphrase; }, set sshPassphrase(v: string) { sshPassphrase = v; },
    get canUndoFill() { return beforeFill !== null; },
    load, save, remove, edit, clearForm, connectTo, importFromUri, currentUri, testConnection, toInput,
    fillFromUri, undoFill, uriOf, formUri,
  };
}
