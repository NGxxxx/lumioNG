import { vaultStatus, vaultUnlock, vaultSetup, vaultReset } from "../api/vault";
import { listConnections } from "../api/connections";
import { errorMessage } from "../api/errors";
import { hasFileSecrets, isWrongPassword, newPasswordProblem, type VaultStatus } from "../domain/vault";
import * as m from "#lib/paraglide/messages.js";

/** Master-password vault state (only relevant when the OS has no keychain). The dialog is
 *  `unlock` while locked, `setup` when offered a first password, and `reset` for "forgot". */
export function createVault() {
  let status = $state<VaultStatus | null>(null);
  let dialog = $state<"unlock" | "setup" | "reset" | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** Bumped whenever secrets became readable (or were wiped), so registries reload their lists. */
  let epoch = $state(0);
  /** Resolver of a pending `ensure()` call (a save waiting for the vault to become usable). */
  let waiter: ((ok: boolean) => void) | null = null;

  function settle(ok: boolean) {
    const w = waiter;
    waiter = null;
    w?.(ok);
  }

  function open(kind: "unlock" | "setup") {
    error = null;
    dialog = kind;
  }

  /** Reads the status; a locked vault opens the unlock dialog right away. */
  async function init(): Promise<VaultStatus | null> {
    try {
      status = await vaultStatus();
    } catch {
      status = null; // outside the desktop shell
      return null;
    }
    if (status === "locked") open("unlock");
    else if (status === "uninitialized") {
      const list = await listConnections().catch(() => []);
      if (hasFileSecrets(list)) open("setup");
    }
    return status;
  }

  /** Called before connecting a saved connection; true when the connect must wait for an unlock. */
  function blocksConnect(): boolean {
    if (status !== "locked") return false;
    open("unlock");
    return true;
  }

  async function run(action: () => Promise<void>, after: () => void): Promise<boolean> {
    busy = true;
    error = null;
    try {
      await action();
      after();
      return true;
    } catch (e) {
      error = isWrongPassword(e) ? m.vault_wrong_password() : errorMessage(e);
      return false;
    } finally {
      busy = false;
    }
  }

  const done = (next: VaultStatus) => () => {
    status = next;
    dialog = null;
    epoch++;
    settle(true);
  };

  function unlock(password: string) {
    if (password === "") {
      error = m.vault_password_empty();
      return Promise.resolve(false);
    }
    return run(() => vaultUnlock(password), done("unlocked"));
  }

  function setup(password: string, confirm: string) {
    const problem = newPasswordProblem(password, confirm);
    if (problem) {
      error = { empty: m.vault_password_empty, short: m.vault_password_short, mismatch: m.vault_password_mismatch }[problem]();
      return Promise.resolve(false);
    }
    return run(() => vaultSetup(password), done("unlocked"));
  }

  /** Destroys the vault and every sealed secret (after the dialog's destructive confirmation). */
  function reset() {
    return run(() => vaultReset(), done("uninitialized"));
  }

  /** Opens the setup or unlock dialog for an action that needs the vault; resolves true once it is usable, false if the user cancels. */
  function ensure(kind: "unlock" | "setup"): Promise<boolean> {
    settle(false);
    open(kind);
    return new Promise((resolve) => { waiter = resolve; });
  }

  return {
    get status() { return status; },
    get dialog() { return dialog; },
    get busy() { return busy; },
    get error() { return error; },
    get epoch() { return epoch; },
    init,
    ensure,
    blocksConnect,
    unlock,
    setup,
    reset,
    askReset() { error = null; dialog = "reset"; },
    backToUnlock() { open("unlock"); },
    dismiss() { error = null; dialog = null; settle(false); },
  };
}

export const vault = createVault();
