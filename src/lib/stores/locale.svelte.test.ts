import { describe, it, expect, vi } from "vitest";

// Mock the Paraglide runtime so we can assert how the store drives it.
const rt = vi.hoisted(() => ({
  getLocale: vi.fn(() => "en"),
  setLocale: vi.fn(),
  overwriteGetLocale: vi.fn(),
}));
vi.mock("#lib/paraglide/runtime.js", () => rt);

import { appLocale } from "./locale.svelte";

describe("appLocale", () => {
  it("initializes from Paraglide and routes getLocale through reactive state", () => {
    expect(appLocale.current).toBe("en");
    expect(rt.overwriteGetLocale).toHaveBeenCalledTimes(1);
    // The override reads the reactive current locale (so inline m.*() re-render).
    const override = rt.overwriteGetLocale.mock.calls[0][0] as () => string;
    expect(override()).toBe("en");
  });

  it("set() switches live without reloading and persists via Paraglide", () => {
    appLocale.set("vi");
    expect(appLocale.current).toBe("vi");
    expect(rt.setLocale).toHaveBeenCalledWith("vi", { reload: false });
    const override = rt.overwriteGetLocale.mock.calls[0][0] as () => string;
    expect(override()).toBe("vi"); // override now reflects the new locale
  });

  it("set() to the current locale is a no-op (no persist call)", () => {
    rt.setLocale.mockClear();
    appLocale.set("vi");
    expect(rt.setLocale).not.toHaveBeenCalled();
    expect(appLocale.current).toBe("vi");
  });
});
