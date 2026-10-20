import { describe, it, expect, beforeEach } from "vitest";
import { createTheme } from "./theme.svelte";
import { prefs } from "./prefs.svelte";

beforeEach(() => {
  prefs.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme store", () => {
  it("defaults to mocha (dark) when nothing is saved", () => {
    const t = createTheme();
    expect(t.current).toBe("mocha");
    expect(document.documentElement.dataset.theme).toBe("mocha");
  });
  it("set() updates current, applies the attribute, and persists", () => {
    const t = createTheme();
    t.set("latte");
    expect(t.current).toBe("latte");
    expect(document.documentElement.dataset.theme).toBe("latte");
    expect(prefs.getItem("theme")).toBe("latte");
  });
  it("restores a saved theme on construction", () => {
    prefs.setItem("theme", "latte");
    const t = createTheme();
    expect(t.current).toBe("latte");
    expect(document.documentElement.dataset.theme).toBe("latte");
  });
  it("ignores an invalid saved key", () => {
    prefs.setItem("theme", "bogus");
    const t = createTheme();
    expect(t.current).toBe("mocha");
  });
});
