import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/csfle", () => ({
  csfleAvailable: vi.fn(async () => true),
  csfleSessionEnabled: vi.fn(),
  csfleEncryptedPaths: vi.fn(),
  onDecryptUnavailable: vi.fn(),
  onDecryptRestored: vi.fn(),
}));
import * as api from "../api/csfle";
import { csfle, createDecryptStatus } from "./csfle.svelte";

beforeEach(() => vi.resetAllMocks());

describe("csfle facade", () => {
  it("never rejects: a failing backend means not enabled / no encrypted paths", async () => {
    vi.mocked(api.csfleSessionEnabled).mockRejectedValue(new Error("no tauri"));
    vi.mocked(api.csfleEncryptedPaths).mockRejectedValue(new Error("boom"));
    expect(await csfle.sessionEnabled("s")).toBe(false);
    expect(await csfle.encryptedPaths("s", "d", "c", "1")).toEqual([]);
    vi.mocked(api.csfleSessionEnabled).mockResolvedValue(true);
    expect(await csfle.sessionEnabled("s")).toBe(true);
  });
});

describe("decrypt status", () => {
  it("records the reason of a fallback per session until dismissed", async () => {
    let fire: (e: { sessionId: string; reason: string }) => void = () => {};
    const unlisten = vi.fn();
    const subscribe = vi.fn(async (cb: typeof fire) => { fire = cb; return unlisten; });
    let ok: (sessionId: string) => void = () => {};
    const subscribeOk = vi.fn(async (cb: typeof ok) => { ok = cb; return unlisten; });
    const st = createDecryptStatus(subscribe, subscribeOk);
    st.start();
    st.start(); // idempotent
    expect(subscribe).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    fire({ sessionId: "a", reason: "Encryption: key not found" });
    expect(st.reasonFor("a")).toContain("key not found");
    expect(st.reasonFor("b")).toBeNull();
    st.dismiss("a");
    expect(st.reasonFor("a")).toBeNull();
    // The next clean read of the same session clears a banner without a click.
    fire({ sessionId: "a", reason: "Encryption: key not found" });
    fire({ sessionId: "b", reason: "Encryption: other" });
    ok("a");
    expect(st.reasonFor("a")).toBeNull();
    expect(st.reasonFor("b")).toContain("other");
    await new Promise((r) => setTimeout(r, 0));
    st.destroy();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
