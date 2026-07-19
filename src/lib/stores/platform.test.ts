import { describe, it, expect } from "vitest";
import { detectPlatform } from "./platform";

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

describe("detectPlatform", () => {
  it("returns \"mac\" for a Mac platform string", () => {
    setPlatform("MacIntel");
    expect(detectPlatform()).toBe("mac");
  });

  it("returns \"mac\" for iPad/iPhone platform strings", () => {
    setPlatform("iPad");
    expect(detectPlatform()).toBe("mac");
  });

  it("returns \"other\" for Windows", () => {
    setPlatform("Win32");
    expect(detectPlatform()).toBe("other");
  });

  it("returns \"other\" for Linux", () => {
    setPlatform("Linux x86_64");
    expect(detectPlatform()).toBe("other");
  });
});
