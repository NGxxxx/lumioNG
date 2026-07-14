import { describe, it, expect } from "vitest";
import { createShell } from "./shell.svelte";

describe("createShell", () => {
  it("setConnection / toggleSession / toggleLog", () => {
    const s = createShell();
    expect(s.connection).toBeNull();
    s.setConnection({ label: "Local", uri: "mongodb://x" });
    expect(s.connection).toEqual({ label: "Local", uri: "mongodb://x" });
    const open = s.sessionOpen;
    s.toggleSession();
    expect(s.sessionOpen).toBe(!open);
    const logOpen = s.logOpen;
    s.toggleLog();
    expect(s.logOpen).toBe(!logOpen);
  });

  it("openSession sets sessionOpen true", () => {
    const s = createShell();
    s.toggleSession(); // false (was true by default)
    s.openSession();
    expect(s.sessionOpen).toBe(true);
  });

  it("setSidebarWidth/setLogHeight clamp to bounds", () => {
    const s = createShell();
    s.setSidebarWidth(10);
    expect(s.sidebarWidth).toBe(160);
    s.setSidebarWidth(9999);
    expect(s.sidebarWidth).toBe(600);
    s.setLogHeight(10);
    expect(s.logHeight).toBe(60);
    s.setLogHeight(9999);
    expect(s.logHeight).toBe(500);
  });

  describe("saved queries section", () => {
    it("defaults open with height 180", () => {
      localStorage.removeItem("saved-queries-open");
      localStorage.removeItem("saved-queries-height-px");
      const s = createShell();
      expect(s.savedQueriesOpen).toBe(true);
      expect(s.savedQueriesHeight).toBe(180);
    });

    it("toggle flips and persists", () => {
      const s = createShell();
      s.toggleSavedQueries();
      expect(s.savedQueriesOpen).toBe(false);
      expect(localStorage.getItem("saved-queries-open")).toBe("false");
      expect(createShell().savedQueriesOpen).toBe(false);
    });

    it("height clamps to 80..500 and persists", () => {
      const s = createShell();
      s.setSavedQueriesHeight(20);
      expect(s.savedQueriesHeight).toBe(80);
      s.setSavedQueriesHeight(900);
      expect(s.savedQueriesHeight).toBe(500);
      s.setSavedQueriesHeight(240.6);
      expect(s.savedQueriesHeight).toBe(241);
      expect(createShell().savedQueriesHeight).toBe(241);
    });
  });
});
