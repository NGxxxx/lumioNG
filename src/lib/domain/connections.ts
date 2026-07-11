/** Validate a structured connection profile before connecting. */
import type { ConnectionProfile } from "./connuri";

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
  return { ok: true };
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
