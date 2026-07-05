import { describe, it, expect, beforeEach } from "vitest";
import { createTheme } from "./theme.svelte";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme store", () => {
  it("defaults to latte when nothing is saved", () => {
    const t = createTheme();
    expect(t.current).toBe("latte");
    expect(document.documentElement.dataset.theme).toBe("latte");
  });
  it("set() updates current, applies the attribute, and persists", () => {
    const t = createTheme();
    t.set("mocha");
    expect(t.current).toBe("mocha");
    expect(document.documentElement.dataset.theme).toBe("mocha");
    expect(localStorage.getItem("theme")).toBe("mocha");
  });
  it("restores a saved theme on construction", () => {
    localStorage.setItem("theme", "mocha");
    const t = createTheme();
    expect(t.current).toBe("mocha");
    expect(document.documentElement.dataset.theme).toBe("mocha");
  });
  it("ignores an invalid saved key", () => {
    localStorage.setItem("theme", "bogus");
    const t = createTheme();
    expect(t.current).toBe("latte");
  });
});
