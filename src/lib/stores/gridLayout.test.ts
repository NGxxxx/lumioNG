import { describe, it, expect, beforeEach } from "vitest";
import { loadLayout, saveLayout, clearLayout, LAYOUT_KEY } from "./gridLayout";
import { prefs } from "./prefs.svelte";

beforeEach(() => prefs.clear());

describe("gridLayout", () => {
  const l = { hidden: ["a"], pinned: ["b"], widths: { b: 200 }, sort: [{ path: "c", dir: -1 as const }], mode: "tree" as const };

  it("saves and loads per namespace", () => {
    saveLayout("s/db/c1", l);
    expect(loadLayout("s/db/c1")).toEqual(l);
    expect(loadLayout("s/db/c2")).toBeNull();
  });

  it("clear forgets one namespace", () => {
    saveLayout("x", l);
    saveLayout("y", l);
    clearLayout("x");
    expect(loadLayout("x")).toBeNull();
    expect(loadLayout("y")).toEqual(l);
  });

  it("corrupt or wrongly shaped storage is ignored", () => {
    prefs.setItem(LAYOUT_KEY, "{oops");
    expect(loadLayout("x")).toBeNull();
    prefs.setItem(LAYOUT_KEY, JSON.stringify({ x: { hidden: "a", pinned: [], widths: {}, sort: [], mode: "grid" } }));
    expect(loadLayout("x")).toBeNull();
    prefs.setItem(LAYOUT_KEY, JSON.stringify({ x: { hidden: [], pinned: [], widths: { a: "wide" }, sort: [{ path: "a", dir: 2 }], mode: "grid" } }));
    expect(loadLayout("x")).toEqual({ hidden: [], pinned: [], widths: {}, sort: [], mode: "grid" });
  });
});
