import { describe, it, expect, vi, beforeEach } from "vitest";

const setDecorations = vi.fn().mockResolvedValue(undefined);
vi.mock("../api/window", () => ({ setDecorations: (on: boolean) => setDecorations(on) }));

import { prefs } from "./prefs.svelte";
import { createWindowFrame } from "./windowFrame.svelte";

beforeEach(() => {
  setDecorations.mockClear();
  prefs.removeItem("window-native-frame");
});

describe("windowFrame", () => {
  it("starts with the custom frame and applies nothing at startup", async () => {
    const f = createWindowFrame();
    expect(f.native).toBe(false);
    await f.init();
    expect(setDecorations).not.toHaveBeenCalled();
  });

  it("toggling stores the choice and tells the window", () => {
    const f = createWindowFrame();
    f.setNative(true);
    expect(f.native).toBe(true);
    expect(prefs.getItem("window-native-frame")).toBe("true");
    expect(setDecorations).toHaveBeenLastCalledWith(true);
    f.setNative(false);
    expect(setDecorations).toHaveBeenLastCalledWith(false);
  });

  it("applies a stored system-frame choice at startup", async () => {
    prefs.setItem("window-native-frame", "true");
    const f = createWindowFrame();
    await f.init();
    expect(setDecorations).toHaveBeenCalledWith(true);
  });
});
