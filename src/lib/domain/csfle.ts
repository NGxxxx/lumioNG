// Pure helpers for client-side field level encryption (CSFLE): recognising encrypted values and
// turning the settings form into the payload the backend expects. No Tauri, no Svelte.
/** Non-secret encryption settings of one saved connection. */
export interface CsfleConfig {
  enabled: boolean;
  /** `database.collection` holding the data keys. */
  keyVaultNamespace: string;
  /** KMS providers that have stored credentials (names only). */
  providers: string[];
  /** Path of the `mongo_crypt_v1` library, for Queryable Encryption. */
  cryptSharedLibPath: string;
}

export interface CsfleView {
  config: CsfleConfig;
  storedProviders: string[];
}

/** Credentials typed in the dialog. A provider left out keeps what is stored. Nothing here is ever returned by the backend. */
export interface KmsInput {
  localKeyFile?: string;
  aws?: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
  azure?: { tenantId: string; clientId: string; clientSecret: string };
  gcp?: { email: string; privateKey: string };
  kmip?: { endpoint: string; caFile: string; clientCertFile: string; certPassword: string };
}

export interface DataKeyInfo {
  /** Base64 of the key's UUID. */
  id: string;
  keyAltNames: string[];
  provider: string;
}

export const KMS_PROVIDERS = ["local", "aws", "azure", "gcp", "kmip"] as const;
export type KmsProviderName = (typeof KMS_PROVIDERS)[number];

export const DEFAULT_KEY_VAULT_NAMESPACE = "encryption.__keyVault";

/** True for a Canonical Extended JSON `{"$binary": {"subType": "06", ...}}`, i.e. a value encrypted by CSFLE. */
export function isEncryptedBinary(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const b = (v as Record<string, unknown>).$binary;
  if (!b || typeof b !== "object") return false;
  const sub = (b as Record<string, unknown>).subType;
  return typeof sub === "string" && /^0*6$/i.test(sub);
}

/** Dotted paths (array elements by index) of every encrypted value inside a document, like the backend's lookup. */
export function ciphertextPaths(doc: unknown, prefix = ""): string[] {
  if (isEncryptedBinary(doc)) return prefix ? [prefix] : [];
  if (!doc || typeof doc !== "object") return [];
  const out: string[] = [];
  const entries = Array.isArray(doc) ? doc.map((v, i) => [String(i), v] as const) : Object.entries(doc);
  for (const [k, v] of entries) out.push(...ciphertextPaths(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

/** `database.collection` with both parts non-empty (the backend re-checks). */
export function isValidNamespace(ns: string): boolean {
  const t = ns.trim();
  const i = t.indexOf(".");
  return i > 0 && i < t.length - 1 && !/[\s/\\"$]/.test(t.slice(0, i));
}

export interface KmsForm {
  localKeyFile: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  azureTenantId: string;
  azureClientId: string;
  azureClientSecret: string;
  gcpEmail: string;
  gcpPrivateKey: string;
  kmipEndpoint: string;
  kmipCaFile: string;
  kmipClientCertFile: string;
  kmipCertPassword: string;
}

export function emptyKmsForm(): KmsForm {
  return {
    localKeyFile: "", awsAccessKeyId: "", awsSecretAccessKey: "", awsSessionToken: "",
    azureTenantId: "", azureClientId: "", azureClientSecret: "", gcpEmail: "", gcpPrivateKey: "",
    kmipEndpoint: "", kmipCaFile: "", kmipClientCertFile: "", kmipCertPassword: "",
  };
}

const filled = (...v: string[]) => v.some((s) => s.trim() !== "");

/**
 * The credentials to send: only providers the user typed something for (an untouched one keeps its
 * stored credentials) and only providers that are switched on in `selected`.
 */
export function buildKmsInput(form: KmsForm, selected: readonly string[]): KmsInput {
  const on = (p: string) => selected.includes(p);
  const out: KmsInput = {};
  if (on("local") && form.localKeyFile.trim()) out.localKeyFile = form.localKeyFile.trim();
  if (on("aws") && filled(form.awsAccessKeyId, form.awsSecretAccessKey, form.awsSessionToken))
    out.aws = { accessKeyId: form.awsAccessKeyId.trim(), secretAccessKey: form.awsSecretAccessKey, sessionToken: form.awsSessionToken };
  if (on("azure") && filled(form.azureTenantId, form.azureClientId, form.azureClientSecret))
    out.azure = { tenantId: form.azureTenantId.trim(), clientId: form.azureClientId.trim(), clientSecret: form.azureClientSecret };
  if (on("gcp") && filled(form.gcpEmail, form.gcpPrivateKey)) out.gcp = { email: form.gcpEmail.trim(), privateKey: form.gcpPrivateKey };
  if (on("kmip") && filled(form.kmipEndpoint, form.kmipCaFile, form.kmipClientCertFile, form.kmipCertPassword))
    out.kmip = { endpoint: form.kmipEndpoint.trim(), caFile: form.kmipCaFile.trim(), clientCertFile: form.kmipClientCertFile.trim(), certPassword: form.kmipCertPassword };
  return out;
}

/**
 * Why the form cannot be saved, or null. `stored` are the providers that already have credentials:
 * a selected provider needs either those or newly typed ones.
 */
export function settingsProblem(
  enabled: boolean,
  namespace: string,
  selected: readonly string[],
  stored: readonly string[],
  input: KmsInput,
): "namespace" | "providers" | "credentials" | null {
  if (!isValidNamespace(namespace)) return "namespace";
  if (!enabled) return null;
  if (selected.length === 0) return "providers";
  for (const p of selected) {
    const typed = p === "local" ? input.localKeyFile : (input as Record<string, unknown>)[p];
    if (!typed && !stored.includes(p)) return "credentials";
  }
  return null;
}

export function buildConfig(enabled: boolean, namespace: string, selected: readonly string[], cryptSharedLibPath: string): CsfleConfig {
  return { enabled, keyVaultNamespace: namespace.trim() || DEFAULT_KEY_VAULT_NAMESPACE, providers: [...selected], cryptSharedLibPath: cryptSharedLibPath.trim() };
}

/** The master key fields each provider asks for when creating a data key (labels are message keys). */
export const MASTER_FIELDS: Record<KmsProviderName, { key: string; labelKey: string }[]> = {
  local: [],
  aws: [{ key: "region", labelKey: "csfle_mk_region" }, { key: "key", labelKey: "csfle_mk_key_arn" }, { key: "endpoint", labelKey: "csfle_mk_endpoint" }],
  azure: [{ key: "keyVaultEndpoint", labelKey: "csfle_mk_kv_endpoint" }, { key: "keyName", labelKey: "csfle_mk_key_name" }, { key: "keyVersion", labelKey: "csfle_mk_key_version" }],
  gcp: [
    { key: "projectId", labelKey: "csfle_mk_project" }, { key: "location", labelKey: "csfle_mk_location" }, { key: "keyRing", labelKey: "csfle_mk_key_ring" },
    { key: "keyName", labelKey: "csfle_mk_key_name" }, { key: "keyVersion", labelKey: "csfle_mk_key_version" },
  ],
  kmip: [{ key: "keyId", labelKey: "csfle_mk_kmip_key_id" }, { key: "endpoint", labelKey: "csfle_mk_endpoint" }],
};

/** The provider-specific master key description for a new data key, as JSON text (null for local / unknown). */
export function masterKeyJson(provider: string, f: Record<string, string>): string | null {
  const fields = (MASTER_FIELDS as Record<string, { key: string }[] | undefined>)[provider];
  if (!fields?.length) return null;
  const entries = fields.map(({ key }) => [key, (f[key] ?? "").trim()] as const).filter(([, x]) => x !== "");
  return JSON.stringify(Object.fromEntries(entries));
}

/** A readable name for a key in a picker: its alternate names, else a short id. */
export function keyLabel(k: DataKeyInfo): string {
  const names = k.keyAltNames.length ? k.keyAltNames.join(", ") : `${k.id.slice(0, 8)}…`;
  return k.provider ? `${names} (${k.provider})` : names;
}

/** Prefix of the backend error for a save that would turn encrypted fields into plain text. */
const PLAINTEXT_REQUIRED = /csfle_plaintext_required:([^\s"]+)/;

/** The encrypted paths a rejected save wants confirmed as plain text, or null when the error is something else. */
export function plaintextRequiredPaths(raw: string): string[] | null {
  const m = PLAINTEXT_REQUIRED.exec(raw);
  return m ? m[1].split(",").filter(Boolean) : null;
}

/** Message key for why decryption is unavailable, from the libmongocrypt text. */
export function decryptReasonKey(raw: string): "csfle_decrypt_key_missing" | "csfle_decrypt_kms" | "csfle_decrypt_generic" {
  if (/key (vault )?(document )?not found|no (data )?key|unable to find|not found in (the )?key/i.test(raw)) return "csfle_decrypt_key_missing";
  if (/kms|credential|access ?denied|unauthori[sz]ed|forbidden|timed out|connect|dns|tls|certificate|http/i.test(raw)) return "csfle_decrypt_kms";
  return "csfle_decrypt_generic";
}
