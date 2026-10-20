import { describe, it, expect, beforeEach } from "vitest";
import { createUiSize } from "./uiSize.svelte";
import { prefs } from "./prefs.svelte";

beforeEach(() => {
  prefs.clear();
  document.documentElement.style.fontSize = "";
});

describe("uiSize store", () => {
  it("defaults to 16px when nothing is saved", () => {
    const s = createUiSize();
    expect(s.current).toBe("default");
    expect(document.documentElement.style.fontSize).toBe("16px");
  });
  it("set() updates current, applies px to the root, and persists", () => {
    const s = createUiSize();
    s.set("large");
    expect(s.current).toBe("large");
    expect(document.documentElement.style.fontSize).toBe("18px");
    expect(prefs.getItem("ui-size")).toBe("large");
  });
  it("restores a saved size on construction", () => {
    prefs.setItem("ui-size", "larger");
    const s = createUiSize();
    expect(s.current).toBe("larger");
    expect(document.documentElement.style.fontSize).toBe("20px");
  });
  it("ignores an invalid saved key", () => {
    prefs.setItem("ui-size", "huge");
    const s = createUiSize();
    expect(s.current).toBe("default");
  });
});
