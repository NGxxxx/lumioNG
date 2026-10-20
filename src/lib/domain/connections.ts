/** Validate a structured connection profile before connecting. */
import { OIDC_ENVIRONMENTS, oidcNeedsResource, type ConnectionProfile } from "./connuri";

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Validate a structured connection profile for the session form. */
export function validateProfile(label: string, p: ConnectionProfile): ValidationResult {
  if (label.trim() === "") return { ok: false, error: "Connection name must not be empty." };
  if (p.host.trim() === "") return { ok: false, error: "Host must not be empty." };
  if (p.port != null && (Number.isNaN(p.port) || p.port < 1 || p.port > 65535)) {
    return { ok: false, error: "Port must be between 1 and 65535." };
  }
  if ((p.authMethod === "password" || p.authMethod === "ldap") && p.user.trim() === "") {
    return { ok: false, error: "User is required for this authentication method." };
  }
  if (p.authMethod === "x509" && p.tlsCertificateKeyFile.trim() === "") {
    return { ok: false, error: "Client certificate file is required for X.509 authentication." };
  }
  if (p.authMethod === "kerberos" && p.user.trim() === "") {
    return { ok: false, error: "Kerberos principal (user@REALM) is required." };
  }
  if (p.authMethod === "oidc" && p.oidcMode === "workload") {
    if (!p.oidcEnvironment || !OIDC_ENVIRONMENTS.includes(p.oidcEnvironment)) {
      return { ok: false, error: "Choose the environment (Azure, GCP or Kubernetes) the workload runs in." };
    }
    if (oidcNeedsResource(p.oidcEnvironment) && (p.oidcTokenResource ?? "").trim() === "") {
      return { ok: false, error: "The token resource (audience) is required for this environment." };
    }
  }
  const proxy = validateProxy(p, false);
  if (!proxy.ok) return proxy;
  return { ok: true };
}

/** Validate the proxy settings of a profile. `sshEnabled`: an SSH tunnel and a proxy cannot be combined. */
export function validateProxy(p: ConnectionProfile, sshEnabled: boolean): ValidationResult {
  const type = p.proxyType ?? "none";
  if (type === "none") return { ok: true };
  if (sshEnabled) return { ok: false, error: "An SSH tunnel and a proxy cannot be used together." };
  if ((p.proxyHost ?? "").trim() === "") return { ok: false, error: "Proxy host must not be empty." };
  const port = p.proxyPort;
  if (port == null || Number.isNaN(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Proxy port must be between 1 and 65535." };
  }
  if (type === "http" && (p.scheme === "mongodb+srv" || p.host.includes(","))) {
    return { ok: false, error: "An HTTP proxy needs a single direct host (no mongodb+srv, no replica set seed list); use SOCKS5 instead." };
  }
  return { ok: true };
}

/** MONGODB-AWS credentials come as a pair; all empty means "use the environment / instance profile". */
export function awsCredentialProblem(keyId: string, secret: string, sessionToken: string): "needs_key_id" | "needs_secret" | null {
  const key = keyId.trim() !== "";
  if (!key && (secret !== "" || sessionToken !== "")) return "needs_key_id";
  if (key && secret === "") return "needs_secret";
  return null;
}

export type SshFormFields = {
  enabled: boolean;
  host: string;
  port: number | null;
  user: string;
  authMethod: "password" | "key";
  privateKeyPath: string;
};

/** Validate the SSH tunnel section of the form; a disabled tunnel is always valid. */
export function validateSsh(s: SshFormFields): ValidationResult {
  if (!s.enabled) return { ok: true };
  if (s.host.trim() === "") return { ok: false, error: "SSH host must not be empty." };
  if (s.port != null && (Number.isNaN(s.port) || s.port < 1 || s.port > 65535)) {
    return { ok: false, error: "SSH port must be between 1 and 65535." };
  }
  if (s.user.trim() === "") return { ok: false, error: "SSH user is required." };
  if (s.authMethod === "key" && s.privateKeyPath.trim() === "") {
    return { ok: false, error: "Private key file is required for key-based SSH auth." };
  }
  return { ok: true };
}
