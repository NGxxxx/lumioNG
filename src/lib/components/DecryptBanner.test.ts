import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/svelte";

let fire: (e: { sessionId: string; reason: string }) => void = () => {};
let restore: (id: string) => void = () => {};
vi.mock("../api/csfle", () => ({
  onDecryptUnavailable: vi.fn(async (cb: typeof fire) => { fire = cb; return () => {}; }),
  onDecryptRestored: vi.fn(async (cb: (id: string) => void) => { restore = cb; return () => {}; }),
}));
vi.mock("../stores/sessionManager.svelte", () => ({ sessionManager: { active: { id: "s1" } } }));
import DecryptBanner from "./DecryptBanner.svelte";

describe("DecryptBanner", () => {
  it("shows a localized reason instead of an error when a read fell back to ciphertext", async () => {
    const { queryByTestId, findByTestId } = render(DecryptBanner);
    expect(queryByTestId("decrypt-banner")).toBeNull();
    await waitFor(() => expect(fire).not.toBe(undefined));
    fire({ sessionId: "other", reason: "Encryption: key not found" });
    expect(queryByTestId("decrypt-banner")).toBeNull(); // another session
    fire({ sessionId: "s1", reason: "Encryption: key not found in key vault" });
    const b = await findByTestId("decrypt-banner");
    expect(b.textContent).toMatch(/Decryption unavailable: the data key was not found/);
    restore("s1"); // the next read decrypted fine
    await waitFor(() => expect(queryByTestId("decrypt-banner")).toBeNull());
  });
});
