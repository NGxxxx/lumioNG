import type { ConnectionProfile } from "./connuri";

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Validate a structured connection profile for the session form. */
export function validateProfile(label: string, p: ConnectionProfile): ValidationResult {
  if (label.trim() === "") return { ok: false, error: "Connection name must not be empty." };
  if (p.host.trim() === "") return { ok: false, error: "Host must not be empty." };
  if (p.port != null && (Number.isNaN(p.port) || p.port < 1 || p.port > 65535)) {
    return { ok: false, error: "Port must be between 1 and 65535." };
  }
  if (p.authMethod === "password" && p.user.trim() === "") {
    return { ok: false, error: "User is required for password authentication." };
  }
  return { ok: true };
}
