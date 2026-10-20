import { invoke } from "@tauri-apps/api/core";
import type { VaultStatus } from "../domain/vault";

export type { VaultStatus };

/** `not_needed` with an OS keychain; otherwise whether the master-password vault is set up / open. */
export async function vaultStatus(): Promise<VaultStatus> {
  return await invoke<VaultStatus>("vault_status");
}

/** Rejects with an error of kind `Vault` ("wrong master password") when the password is wrong. */
export async function vaultUnlock(password: string): Promise<void> {
  await invoke("vault_unlock", { password });
}

/** Creates the vault and seals the secrets already saved in the connections file. */
export async function vaultSetup(password: string): Promise<void> {
  await invoke("vault_setup", { password });
}

/** "Forgot master password": deletes the vault and every sealed secret. Irreversible. */
export async function vaultReset(): Promise<void> {
  await invoke("vault_reset");
}
