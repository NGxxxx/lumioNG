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
});
