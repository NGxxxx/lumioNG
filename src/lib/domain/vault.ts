// Pure helpers for the master-password vault (the file fallback of saved secrets).

/** What `vault_status` reports. */
export type VaultStatus = "not_needed" | "locked" | "unlocked" | "uninitialized";

/** Whether any saved connection keeps a secret in the connections file as plain obfuscated text
 *  (not in the OS keychain, not sealed) — the case where offering a master password makes sense.
 *  Matches every `*Enc` field by name, so newly added secret fields are covered automatically. */
export function hasFileSecrets(list: readonly object[]): boolean {
  return list.some((c) => {
    const rec = c as Record<string, unknown>;
    if (rec.secretsInKeychain === true) return false;
    return Object.entries(rec).some(([k, v]) => k.endsWith("Enc") && typeof v === "string" && v !== "" && !v.startsWith("vault:"));
  });
}

/** The backend rejected the master password (as opposed to some other vault failure). */
export function isWrongPassword(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { kind?: string; message?: string };
  return err.kind === "Vault" && /wrong master password/i.test(err.message ?? "");
}

/** Why a new master password is not acceptable, as a message key suffix, or null when it is fine. */
export function newPasswordProblem(password: string, confirm: string): "empty" | "short" | "mismatch" | null {
  if (password === "") return "empty";
  if ([...password].length < 8) return "short";
  if (password !== confirm) return "mismatch";
  return null;
}

/** Why the backend refused to save a secret (see `seal_list` in secrets.rs): the vault is not set up, locked, or could not seal. */
export type VaultRefusal = "vault_uninitialized" | "vault_locked" | "vault_seal_failed";

export function vaultRefusal(e: unknown): VaultRefusal | null {
  if (!e || typeof e !== "object") return null;
  const err = e as { kind?: string; message?: string };
  if (err.kind !== "Vault") return null;
  return err.message === "vault_uninitialized" || err.message === "vault_locked" || err.message === "vault_seal_failed" ? err.message : null;
}

/** A copy of `input` with every `*Enc` secret field blanked ("save without password"). */
export function withoutSecrets<T extends object>(input: T): T {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, k.endsWith("Enc") && typeof v === "string" ? "" : v])) as T;
}
