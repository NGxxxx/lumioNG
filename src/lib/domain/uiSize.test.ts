import { describe, it, expect } from "vitest";
import { UI_SIZES, uiSizePx } from "./uiSize";

describe("uiSize", () => {
  it("maps each preset key to its px", () => {
    expect(uiSizePx("small")).toBe(14);
    expect(uiSizePx("default")).toBe(16);
    expect(uiSizePx("large")).toBe(18);
    expect(uiSizePx("larger")).toBe(20);
  });
  it("falls back to the default px for an unknown key", () => {
    expect(uiSizePx("huge")).toBe(16);
  });
  it("lists presets in ascending size order", () => {
    expect(UI_SIZES.map((s) => s.key)).toEqual(["small", "default", "large", "larger"]);
  });
});
