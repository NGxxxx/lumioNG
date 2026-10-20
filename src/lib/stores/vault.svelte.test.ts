import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/vault", () => ({
  vaultStatus: vi.fn(),
  vaultUnlock: vi.fn(),
  vaultSetup: vi.fn(),
  vaultReset: vi.fn(),
}));
vi.mock("../api/connections", () => ({ listConnections: vi.fn() }));

import { vaultStatus, vaultUnlock, vaultSetup, vaultReset } from "../api/vault";
import { listConnections } from "../api/connections";
import { createVault } from "./vault.svelte";

const mocked = <T extends (...a: never[]) => unknown>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

describe("vault store", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does nothing with an OS keychain", async () => {
    mocked(vaultStatus).mockResolvedValue("not_needed");
    const v = createVault();
    await v.init();
    expect(v.dialog).toBeNull();
    expect(v.blocksConnect()).toBe(false);
    expect(listConnections).not.toHaveBeenCalled();
  });

  it("opens the unlock dialog at startup when locked and blocks connecting until unlocked", async () => {
    mocked(vaultStatus).mockResolvedValue("locked");
    const v = createVault();
    await v.init();
    expect(v.dialog).toBe("unlock");
    v.dismiss();
    expect(v.blocksConnect()).toBe(true);
    expect(v.dialog).toBe("unlock");

    mocked(vaultUnlock).mockResolvedValue(undefined);
    expect(await v.unlock("pw")).toBe(true);
    expect(v.status).toBe("unlocked");
    expect(v.dialog).toBeNull();
    expect(v.epoch).toBe(1);
    expect(v.blocksConnect()).toBe(false);
  });

  it("keeps the dialog open with a message on a wrong password", async () => {
    mocked(vaultStatus).mockResolvedValue("locked");
    const v = createVault();
    await v.init();
    mocked(vaultUnlock).mockRejectedValue({ kind: "Vault", message: "wrong master password" });
    expect(await v.unlock("nope")).toBe(false);
    expect(v.dialog).toBe("unlock");
    expect(v.error).toBeTruthy();
    expect(v.status).toBe("locked");
    expect(v.busy).toBe(false);
  });

  it("offers setup only when plain secrets exist in the file", async () => {
    mocked(vaultStatus).mockResolvedValue("uninitialized");
    mocked(listConnections).mockResolvedValue([{ passwordEnc: "" }] as never);
    const none = createVault();
    await none.init();
    expect(none.dialog).toBeNull();

    mocked(listConnections).mockResolvedValue([{ passwordEnc: "abc" }] as never);
    const some = createVault();
    await some.init();
    expect(some.dialog).toBe("setup");
  });

  it("validates a new password before calling the backend", async () => {
    const v = createVault();
    expect(await v.setup("short", "short")).toBe(false);
    expect(await v.setup("longenough", "different")).toBe(false);
    expect(vaultSetup).not.toHaveBeenCalled();
    mocked(vaultSetup).mockResolvedValue(undefined);
    expect(await v.setup("longenough", "longenough")).toBe(true);
    expect(vaultSetup).toHaveBeenCalledWith("longenough");
    expect(v.status).toBe("unlocked");
  });

  it("reset returns to uninitialized and reloads registries", async () => {
    mocked(vaultStatus).mockResolvedValue("locked");
    const v = createVault();
    await v.init();
    v.askReset();
    expect(v.dialog).toBe("reset");
    mocked(vaultReset).mockResolvedValue(undefined);
    expect(await v.reset()).toBe(true);
    expect(v.status).toBe("uninitialized");
    expect(v.dialog).toBeNull();
    expect(v.epoch).toBe(1);
  });
});
