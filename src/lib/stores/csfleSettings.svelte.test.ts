import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/csfle", () => ({
  csfleGet: vi.fn(),
  csfleSave: vi.fn(),
  csfleGenerateLocalKey: vi.fn(),
}));
import * as api from "../api/csfle";
import { createCsfleSettings } from "./csfleSettings.svelte";

const view = (over = {}) => ({
  config: { enabled: true, keyVaultNamespace: "kv.keys", providers: ["aws"], cryptSharedLibPath: "" },
  storedProviders: ["aws"],
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe("createCsfleSettings", () => {
  it("loads settings and the list of stored providers, never credentials", async () => {
    vi.mocked(api.csfleGet).mockResolvedValue(view());
    const s = createCsfleSettings(7);
    await s.load();
    expect(api.csfleGet).toHaveBeenCalledWith(7);
    expect([s.enabled, s.namespace, s.selected, s.stored]).toEqual([true, "kv.keys", ["aws"], ["aws"]]);
    expect(s.form.awsSecretAccessKey).toBe("");
    expect(s.problem).toBeNull();
  });

  it("does nothing for an unsaved connection", async () => {
    const s = createCsfleSettings(null);
    await s.load();
    expect(await s.save()).toBe(false);
    expect(api.csfleGet).not.toHaveBeenCalled();
  });

  it("sends only typed credentials and reloads after saving", async () => {
    vi.mocked(api.csfleGet).mockResolvedValue(view({ config: { enabled: false, keyVaultNamespace: "encryption.__keyVault", providers: [], cryptSharedLibPath: "" }, storedProviders: [] }));
    vi.mocked(api.csfleSave).mockResolvedValue("keychain");
    const s = createCsfleSettings(3);
    await s.load();
    s.enabled = true;
    s.toggleProvider("aws", true);
    expect(s.problem).toBe("credentials");
    expect(await s.save()).toBe(false);
    s.form.awsAccessKeyId = "AK";
    s.form.awsSecretAccessKey = "SK";
    expect(s.problem).toBeNull();
    expect(await s.save()).toBe(true);
    const [id, config, kms] = vi.mocked(api.csfleSave).mock.calls[0];
    expect(id).toBe(3);
    expect(config).toMatchObject({ enabled: true, providers: ["aws"] });
    expect(kms).toEqual({ aws: { accessKeyId: "AK", secretAccessKey: "SK", sessionToken: "" } });
    expect(s.savedTo).toBe("keychain");
    expect(s.form.awsSecretAccessKey).toBe("");
  });

  it("surfaces a backend refusal and clears it on the next attempt", async () => {
    vi.mocked(api.csfleGet).mockResolvedValue(view());
    vi.mocked(api.csfleSave).mockRejectedValueOnce({ kind: "Vault", message: "vault_locked" }).mockResolvedValue("vault");
    const s = createCsfleSettings(1);
    await s.load();
    expect(await s.save()).toBe(false);
    expect(s.error).toBeTruthy();
    expect(await s.save()).toBe(true);
    expect(s.error).toBeNull();
  });

  it("generates a local key file and fills the path", async () => {
    vi.mocked(api.csfleGenerateLocalKey).mockResolvedValue(undefined);
    const s = createCsfleSettings(1);
    expect(await s.generateLocalKey("/tmp/k.key")).toBe(true);
    expect(s.form.localKeyFile).toBe("/tmp/k.key");
  });
});
