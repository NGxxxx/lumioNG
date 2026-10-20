// Saving a password with no OS keychain: the backend refuses until the vault is usable.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/connections", () => ({
  getSecretStorage: vi.fn(async () => "file"),
  listConnections: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("../api/vault", () => ({
  vaultStatus: vi.fn(),
  vaultUnlock: vi.fn(),
  vaultSetup: vi.fn(),
  vaultReset: vi.fn(),
}));
import * as conns from "../api/connections";
import { vaultSetup, vaultUnlock } from "../api/vault";
import { createConnectionRegistry } from "./connections.svelte";
import { vault } from "./vault.svelte";
import { toast } from "./toast.svelte";
import { deobfuscate } from "../domain/secret";

const save = conns.saveConnection as ReturnType<typeof vi.fn>;
const refusal = (code: string) => ({ kind: "Vault", message: code });

function filledForm() {
  const r = createConnectionRegistry();
  r.label = "Prod"; r.host = "db"; r.authMethod = "password"; r.user = "u"; r.password = "s3cret";
  return r;
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe("save without a keychain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vault.dismiss();
  });

  it("opens setup when the vault is uninitialized and retries the save after setup", async () => {
    save.mockRejectedValueOnce(refusal("vault_uninitialized")).mockResolvedValueOnce([]);
    (vaultSetup as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const r = filledForm();
    const done = r.save();
    await tick();
    expect(vault.dialog).toBe("setup");
    expect(await vault.setup("longenough", "longenough")).toBe(true);
    await done;
    expect(save).toHaveBeenCalledTimes(2);
    expect(deobfuscate(save.mock.calls[1][1].passwordEnc)).toBe("s3cret");
    expect(r.error).toBeNull();
    expect(r.offerSaveWithoutPassword).toBe(false);
  });

  it("opens unlock when the vault is locked and retries after unlocking", async () => {
    save.mockRejectedValueOnce(refusal("vault_locked")).mockResolvedValueOnce([]);
    (vaultUnlock as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const r = filledForm();
    const done = r.save();
    await tick();
    expect(vault.dialog).toBe("unlock");
    await vault.unlock("longenough");
    await done;
    expect(save).toHaveBeenCalledTimes(2);
    expect(r.error).toBeNull();
  });

  it("offers Save without password when the user cancels, and saves with every secret blank", async () => {
    save.mockRejectedValueOnce(refusal("vault_uninitialized")).mockResolvedValueOnce([]);
    const r = filledForm();
    const done = r.save();
    await tick();
    vault.dismiss();
    await done;
    expect(save).toHaveBeenCalledTimes(1);
    expect(r.offerSaveWithoutPassword).toBe(true);
    expect(r.error).toBeTruthy();

    await r.saveWithoutPassword();
    expect(save).toHaveBeenCalledTimes(2);
    const input = save.mock.calls[1][1];
    expect(input.passwordEnc).toBe("");
    expect(input.sshPasswordEnc).toBe("");
    expect(r.offerSaveWithoutPassword).toBe(false);
    expect(toast.toasts.some((t: { message: string }) => /without its password/i.test(t.message))).toBe(true);
  });

  it("other save errors are shown as before without opening the vault", async () => {
    save.mockRejectedValueOnce({ kind: "Io", message: "disk full" });
    const r = filledForm();
    await r.save();
    expect(vault.dialog).toBeNull();
    expect(r.offerSaveWithoutPassword).toBe(false);
    expect(r.error).toContain("disk full");
  });
});

describe("save without password clears held secrets", () => {
  beforeEach(() => { vi.clearAllMocks(); vault.dismiss(); });

  it("tells the backend to drop sealed secrets only for the explicit save-without-password", async () => {
    save.mockRejectedValueOnce(refusal("vault_locked")).mockResolvedValue([]);
    const r = filledForm();
    const done = r.save();
    await tick();
    vault.dismiss();
    await done;
    expect(save.mock.calls[0][2]).toBe(false);
    await r.saveWithoutPassword();
    expect(save.mock.calls[1][2]).toBe(true);
  });
});

describe("legacy uri migration with a refusing vault", () => {
  beforeEach(() => { vi.clearAllMocks(); vault.dismiss(); });

  it("keeps every connection, saves the password-bearing one without its password, and toasts once", async () => {
    const legacy = (id: number, label: string, uri: string) =>
      ({ id, label, scheme: "", host: "", port: null, authMethod: "none", user: "", passwordEnc: "", authSource: "", replicaSet: "", tls: false, extraOptions: "", uri }) as never;
    const fetched = [
      legacy(1, "WithPw", "mongodb://bob:hunter2@h1:27017/?authSource=admin"),
      legacy(2, "NoPw", "mongodb://h2:27017"),
    ];
    (conns.listConnections as ReturnType<typeof vi.fn>).mockResolvedValue(fetched);
    const row = (id: number, label: string) => ({ id, label, host: "h", passwordEnc: "" }) as never;
    save.mockImplementation(async (id: number, input: { passwordEnc: string; label: string }) => {
      if (input.passwordEnc !== "") throw refusal("vault_uninitialized");
      return [row(1, "WithPw"), row(id, input.label)].filter((c: { id: number }, i: number, a: { id: number }[]) => a.findIndex((x) => x.id === c.id) === i);
    });
    const before = toast.toasts.length;
    const r = createConnectionRegistry();
    await r.load();
    expect(r.list.length).toBe(2);
    const withPw = save.mock.calls.filter((c) => c[0] === 1);
    expect(withPw.length).toBe(2); // refused, then retried blank
    expect(withPw[1][1].passwordEnc).toBe("");
    expect(vault.dialog).toBeNull(); // migration must not pop dialogs
    const added = toast.toasts.slice(before);
    expect(added.length).toBe(1);
    expect(added[0].message).toContain("WithPw");
    expect(added[0].message).not.toContain("NoPw");
  });
});
