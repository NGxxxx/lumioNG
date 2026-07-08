import { describe, it, expect, beforeEach } from "vitest";
import { createSettings } from "./settings.svelte";

beforeEach(() => localStorage.clear());

describe("settings", () => {
  it("defaults suppressDestructiveWarning to false", () => {
    expect(createSettings().suppressDestructiveWarning).toBe(false);
  });

  it("persists the flag across instances", () => {
    const a = createSettings();
    a.setSuppressDestructiveWarning(true);
    expect(createSettings().suppressDestructiveWarning).toBe(true);
  });

  it("defaults query timeout to 30000ms and cap to 1000", () => {
    const s = createSettings();
    expect(s.queryTimeoutMs).toBe(30000);
    expect(s.queryResultCap).toBe(1000);
  });

  it("persists query timeout and cap across instances", () => {
    const a = createSettings();
    a.setQueryTimeoutMs(5000);
    a.setQueryResultCap(250);
    const b = createSettings();
    expect(b.queryTimeoutMs).toBe(5000);
    expect(b.queryResultCap).toBe(250);
  });

  it("ignores non-positive or non-finite values, keeping the previous setting", () => {
    const a = createSettings();
    a.setQueryTimeoutMs(0);
    a.setQueryResultCap(-5);
    expect(a.queryTimeoutMs).toBe(30000);
    expect(a.queryResultCap).toBe(1000);
    a.setQueryTimeoutMs(NaN);
    expect(a.queryTimeoutMs).toBe(30000);
  });

  it("defaults queryResultCapUnlimited to false and persists it across instances", () => {
    const a = createSettings();
    expect(a.queryResultCapUnlimited).toBe(false);
    a.setQueryResultCapUnlimited(true);
    const b = createSettings();
    expect(b.queryResultCapUnlimited).toBe(true);
  });

  it("defaults wrapLongLines to false and persists it across instances", () => {
    const a = createSettings();
    expect(a.wrapLongLines).toBe(false);
    a.setWrapLongLines(true);
    const b = createSettings();
    expect(b.wrapLongLines).toBe(true);
  });
});
