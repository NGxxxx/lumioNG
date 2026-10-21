import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/csfle", () => ({
  csfleListKeys: vi.fn(),
  csfleCreateDataKey: vi.fn(),
  csfleEncrypt: vi.fn(),
}));
import * as api from "../api/csfle";
import { createEncryptFlow } from "./csfleEncrypt.svelte";

const k = (id: string, name: string) => ({ id, keyAltNames: [name], provider: "local" });

beforeEach(() => vi.resetAllMocks());

describe("createEncryptFlow", () => {
  it("lists keys and preselects the first", async () => {
    vi.mocked(api.csfleListKeys).mockResolvedValue([k("a", "pii"), k("b", "pay")]);
    const f = createEncryptFlow("s1");
    await f.loadKeys();
    expect(api.csfleListKeys).toHaveBeenCalledWith("s1");
    expect(f.keyId).toBe("a");
  });

  it("encrypts the value as Extended JSON and returns the parsed binary", async () => {
    vi.mocked(api.csfleListKeys).mockResolvedValue([k("a", "pii")]);
    vi.mocked(api.csfleEncrypt).mockResolvedValue('{"$binary":{"base64":"AQ==","subType":"06"}}');
    const f = createEncryptFlow("s1");
    await f.loadKeys();
    f.algorithm = "random";
    const out = await f.encrypt({ $numberInt: "5" });
    expect(api.csfleEncrypt).toHaveBeenCalledWith("s1", '{"$numberInt":"5"}', { keyId: "a", keyAltName: null }, "random");
    expect(out).toEqual({ $binary: { base64: "AQ==", subType: "06" } });
  });

  it("returns null and an error when encryption fails or no key is chosen", async () => {
    const f = createEncryptFlow("s1");
    expect(await f.encrypt("x")).toBeNull();
    expect(api.csfleEncrypt).not.toHaveBeenCalled();
    vi.mocked(api.csfleListKeys).mockResolvedValue([k("a", "pii")]);
    vi.mocked(api.csfleEncrypt).mockRejectedValue({ kind: "Query", message: "Encryption: key not found" });
    await f.loadKeys();
    expect(await f.encrypt("x")).toBeNull();
    expect(f.error).toContain("key not found");
  });

  it("creates a data key, reloads the list and selects the new key", async () => {
    vi.mocked(api.csfleListKeys).mockResolvedValueOnce([]).mockResolvedValue([k("n", "new")]);
    vi.mocked(api.csfleCreateDataKey).mockResolvedValue("n");
    const f = createEncryptFlow("s1");
    await f.loadKeys();
    expect(await f.createKey("aws", " new ", { region: "r", key: "arn" })).toBe(true);
    expect(api.csfleCreateDataKey).toHaveBeenCalledWith("s1", "aws", "new", '{"region":"r","key":"arn"}');
    expect(f.keyId).toBe("n");
  });
});
