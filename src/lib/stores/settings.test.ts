import { describe, it, expect, beforeEach } from "vitest";
import { createSettings, MIN_PANE_PX } from "./settings.svelte";

beforeEach(() => localStorage.clear());

describe("settings", () => {
  it("quick-look drawer: width defaults to 360 and clamps to >= 280; pinned defaults off; both persist", () => {
    const a = createSettings();
    expect(a.peekWidth).toBe(360);
    expect(a.peekPinned).toBe(false);
    a.setPeekWidth(100);
    expect(a.peekWidth).toBe(280);
    a.setPeekWidth(500);
    a.setPeekPinned(true);
    const b = createSettings();
    expect(b.peekWidth).toBe(500);
    expect(b.peekPinned).toBe(true);
  });

  it("density defaults to comfortable and persists", () => {
    const a = createSettings();
    expect(a.density).toBe("comfortable");
    a.setDensity("compact");
    expect(createSettings().density).toBe("compact");
  });

  it("an unknown stored density falls back to comfortable", () => {
    localStorage.setItem("grid-density", "huge");
    expect(createSettings().density).toBe("comfortable");
  });

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

  it("defaults queryEditorHeightPx to null", () => {
    expect(createSettings().queryEditorHeightPx).toBeNull();
  });

  it("persists queryEditorHeightPx across instances, floored at MIN_PANE_PX", () => {
    const a = createSettings();
    a.setQueryEditorHeightPx(300);
    const b = createSettings();
    expect(b.queryEditorHeightPx).toBe(300);

    a.setQueryEditorHeightPx(10); // below the floor
    expect(a.queryEditorHeightPx).toBe(MIN_PANE_PX);
  });

  it("resetQueryEditorHeight clears the override back to null and drops the storage key", () => {
    const a = createSettings();
    a.setQueryEditorHeightPx(300);
    a.resetQueryEditorHeight();
    expect(a.queryEditorHeightPx).toBeNull();
    const b = createSettings();
    expect(b.queryEditorHeightPx).toBeNull();
  });

  it("defaults gridMaxDepth to 1", () => {
    expect(createSettings().gridMaxDepth).toBe(1);
  });

  it("persists gridMaxDepth across instances, including All (null)", () => {
    const a = createSettings();
    a.setGridMaxDepth(3);
    expect(createSettings().gridMaxDepth).toBe(3);
    a.setGridMaxDepth(null);
    expect(a.gridMaxDepth).toBeNull();
    expect(createSettings().gridMaxDepth).toBeNull();
  });

  it("ignores non-positive or non-finite gridMaxDepth values", () => {
    const a = createSettings();
    a.setGridMaxDepth(0);
    a.setGridMaxDepth(NaN);
    expect(a.gridMaxDepth).toBe(1);
  });
});
