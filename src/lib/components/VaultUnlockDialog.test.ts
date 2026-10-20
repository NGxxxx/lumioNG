import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";

vi.mock("#lib/api/vault.js", () => ({
  vaultStatus: vi.fn(),
  vaultUnlock: vi.fn(),
  vaultSetup: vi.fn(),
  vaultReset: vi.fn(),
}));
vi.mock("#lib/api/connections.js", () => ({ listConnections: vi.fn() }));

import VaultUnlockDialog from "./VaultUnlockDialog.svelte";
import { createVault } from "#lib/stores/vault.svelte.js";
import { vaultStatus, vaultUnlock, vaultReset } from "#lib/api/vault.js";

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

describe("VaultUnlockDialog", () => {
  beforeEach(() => vi.resetAllMocks());

  it("unlocks with the typed password and closes", async () => {
    fn(vaultStatus).mockResolvedValue("locked");
    fn(vaultUnlock).mockResolvedValue(undefined);
    const store = createVault();
    await store.init();
    const { getByLabelText, getByRole, queryByLabelText } = render(VaultUnlockDialog, { store });
    await fireEvent.input(getByLabelText("Master password"), { target: { value: "hunter22" } });
    await fireEvent.click(getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(vaultUnlock).toHaveBeenCalledWith("hunter22"));
    await waitFor(() => expect(queryByLabelText("Master password")).toBeNull());
  });

  it("shows an error for a wrong password and stays open", async () => {
    fn(vaultStatus).mockResolvedValue("locked");
    fn(vaultUnlock).mockRejectedValue({ kind: "Vault", message: "wrong master password" });
    const store = createVault();
    await store.init();
    const { getByLabelText, getByRole, findByRole } = render(VaultUnlockDialog, { store });
    await fireEvent.input(getByLabelText("Master password"), { target: { value: "bad" } });
    await fireEvent.click(getByRole("button", { name: "Unlock" }));
    expect((await findByRole("alert")).textContent).toContain("Wrong master password");
  });

  it("forgot password asks for a destructive confirmation before resetting", async () => {
    fn(vaultStatus).mockResolvedValue("locked");
    fn(vaultReset).mockResolvedValue(undefined);
    const store = createVault();
    await store.init();
    const { getByRole, findByRole } = render(VaultUnlockDialog, { store });
    await fireEvent.click(getByRole("button", { name: "Forgot master password?" }));
    expect(vaultReset).not.toHaveBeenCalled();
    await fireEvent.click(await findByRole("button", { name: "Erase saved passwords" }));
    await waitFor(() => expect(vaultReset).toHaveBeenCalled());
    expect(store.status).toBe("uninitialized");
  });
});
