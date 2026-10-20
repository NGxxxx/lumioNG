import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/diagnostics", () => ({ logFrontend: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../api/prefs", () => ({
  loadPrefs: vi.fn(),
  savePrefs: vi.fn(),
  exportPrefs: vi.fn(),
  importPrefs: vi.fn(),
}));

import { loadPrefs, savePrefs, exportPrefs, importPrefs } from "../api/prefs";
import { logFrontend } from "../api/diagnostics";
import { createPrefs } from "./prefs.svelte";

const load = loadPrefs as ReturnType<typeof vi.fn>;
const save = savePrefs as ReturnType<typeof vi.fn>;

describe("prefs store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    load.mockReset().mockResolvedValue({});
    save.mockReset().mockResolvedValue(undefined);
    (exportPrefs as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
    (importPrefs as ReturnType<typeof vi.fn>).mockReset();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it("setItem_is_visible_immediately", () => {
    const p = createPrefs();
    expect(p.getItem("theme")).toBeNull();
    p.setItem("theme", "latte");
    expect(p.getItem("theme")).toBe("latte");
    p.removeItem("theme");
    expect(p.getItem("theme")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("writes_are_debounced_into_one_save", async () => {
    const p = createPrefs();
    p.setItem("a", "1");
    await vi.advanceTimersByTimeAsync(200);
    p.setItem("b", "2");
    p.setItem("a", "3");
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ a: "3", b: "2" });
  });

  it("hydrate loads the file, migrates localStorage once and saves", async () => {
    load.mockResolvedValue({ theme: "mocha" });
    localStorage.setItem("theme", "latte");
    localStorage.setItem("ui-size", "large");
    const p = createPrefs();
    await p.hydrate();
    expect(p.getItem("theme")).toBe("mocha");
    expect(p.getItem("ui-size")).toBe("large");
    expect(p.getItem("__migrated_v1")).toBe("1");
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ui-size")).toBe("large"); // kept as a fallback
  });

  it("hydrate does not save when nothing changed", async () => {
    load.mockResolvedValue({ __migrated_v1: "1", a: "1" });
    const p = createPrefs();
    await p.hydrate();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });

  it("hydrate falls back to an empty in-memory store when loading fails", async () => {
    load.mockRejectedValue(new Error("no tauri"));
    const p = createPrefs();
    p.setItem("early", "1");
    await p.hydrate();
    expect(p.getItem("early")).toBe("1");
  });

  it("hydrate lets the file win over a key written before it finished", async () => {
    load.mockResolvedValue({ "mcp-token": "from-file", __migrated_v1: "1" });
    const p = createPrefs();
    p.setItem("mcp-token", "fresh-default");
    p.setItem("only-early", "1");
    await p.hydrate();
    expect(p.getItem("mcp-token")).toBe("from-file");
    expect(p.getItem("only-early")).toBe("1");
  });

  it("clear keeps the migration flag so old localStorage is not resurrected", async () => {
    load.mockResolvedValue({ __migrated_v1: "1", a: "1" });
    const p = createPrefs();
    await p.hydrate();
    p.clear();
    expect(p.getItem("a")).toBeNull();
    expect(p.getItem("__migrated_v1")).toBe("1");
    await p.flush();
    expect(save).toHaveBeenLastCalledWith({ __migrated_v1: "1" });
  });

  it("afterHydrate callbacks run once hydration completes", async () => {
    load.mockResolvedValue({ a: "1" });
    const p = createPrefs();
    const cb = vi.fn(() => p.getItem("a"));
    p.afterHydrate(cb);
    await p.hydrate();
    expect(cb).toHaveReturnedWith("1");
  });

  it("keys lists names only and importFrom replaces everything", async () => {
    const p = createPrefs();
    p.setItem("x", "secret");
    expect(p.keys()).toEqual(["x"]);
    (importPrefs as ReturnType<typeof vi.fn>).mockResolvedValue({ theme: "latte" });
    await p.importFrom("/tmp/s.json");
    expect(p.getItem("x")).toBeNull();
    expect(p.getItem("theme")).toBe("latte");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "latte", __migrated_v1: "1" }));
  });

  it("importFrom flushes first and keeps the mcp-* values the backend merged in", async () => {
    const p = createPrefs();
    p.setItem("mcp-token", "mine");
    const imp = importPrefs as ReturnType<typeof vi.fn>;
    imp.mockImplementation(async () => {
      expect(save).toHaveBeenCalledWith({ "mcp-token": "mine" }); // current state reached disk before the merge
      return { theme: "latte", "mcp-token": "mine" };
    });
    await p.importFrom("/tmp/s.json");
    expect(p.getItem("mcp-token")).toBe("mine");
    expect(p.getItem("theme")).toBe("latte");
  });

  it("does not write to disk after a failed load, and logs a warning", async () => {
    load.mockRejectedValue(new Error("boom"));
    const p = createPrefs();
    await p.hydrate();
    expect(logFrontend).toHaveBeenCalledWith("warn", expect.stringContaining("could not be loaded"), expect.any(String));
    p.setItem("a", "1");
    await vi.advanceTimersByTimeAsync(1000);
    await p.flush();
    expect(save).not.toHaveBeenCalled();
    expect(p.getItem("a")).toBe("1");
  });

  it("flush only saves when something changed", async () => {
    const p = createPrefs();
    await p.flush();
    expect(save).not.toHaveBeenCalled();
    p.setItem("a", "1");
    await p.flush();
    await p.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
