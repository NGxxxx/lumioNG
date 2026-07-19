import { describe, it, expect } from "vitest";
import { matchesEvent, formatCombo } from "./shortcuts";

function evt(partial: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  } as KeyboardEvent;
}

describe("matchesEvent", () => {
  it("matches Mod+S as Ctrl+S on non-mac", () => {
    expect(matchesEvent("Mod+S", evt({ key: "s", ctrlKey: true }), "other")).toBe(true);
  });

  it("matches Mod+S as Cmd+S on mac, not Ctrl+S", () => {
    expect(matchesEvent("Mod+S", evt({ key: "s", ctrlKey: true }), "mac")).toBe(false);
    expect(matchesEvent("Mod+S", evt({ key: "s", metaKey: true }), "mac")).toBe(true);
  });

  it("rejects when an extra modifier is held", () => {
    expect(matchesEvent("Mod+S", evt({ key: "s", ctrlKey: true, shiftKey: true }), "other")).toBe(false);
  });

  it("matches a bare function key with no modifiers", () => {
    expect(matchesEvent("F9", evt({ key: "F9" }), "other")).toBe(true);
  });

  it("rejects a bare function key if a modifier is held", () => {
    expect(matchesEvent("F9", evt({ key: "F9", ctrlKey: true }), "other")).toBe(false);
  });

  it("matches multi-modifier combos", () => {
    expect(matchesEvent("Mod+Shift+F9", evt({ key: "F9", ctrlKey: true, shiftKey: true }), "other")).toBe(true);
  });

  it("is case-insensitive on the key", () => {
    expect(matchesEvent("Mod+S", evt({ key: "S", ctrlKey: true }), "other")).toBe(true);
  });

  it("matches single-character keys like Insert/Delete/Escape by name", () => {
    expect(matchesEvent("Insert", evt({ key: "Insert" }), "other")).toBe(true);
    expect(matchesEvent("Mod+Delete", evt({ key: "Delete", ctrlKey: true }), "other")).toBe(true);
    expect(matchesEvent("Escape", evt({ key: "Escape" }), "other")).toBe(true);
  });
});

describe("formatCombo", () => {
  it("formats Mod+S for non-mac as Ctrl+S", () => {
    expect(formatCombo("Mod+S", "other")).toBe("Ctrl+S");
  });

  it("formats Mod+S for mac as ⌘S with no separator", () => {
    expect(formatCombo("Mod+S", "mac")).toBe("⌘S");
  });

  it("formats a bare function key unchanged", () => {
    expect(formatCombo("F9", "other")).toBe("F9");
  });

  it("formats special key names", () => {
    expect(formatCombo("Mod+Insert", "other")).toBe("Ctrl+Ins");
    expect(formatCombo("Escape", "other")).toBe("Esc");
    expect(formatCombo("Mod+Delete", "other")).toBe("Ctrl+Del");
  });

  it("formats a three-part combo", () => {
    expect(formatCombo("Mod+Shift+F9", "other")).toBe("Ctrl+Shift+F9");
  });

  it("formats Alt and Shift with mac symbols", () => {
    expect(formatCombo("Mod+Alt+A", "mac")).toBe("⌘⌥A");
    expect(formatCombo("Mod+Shift+Tab", "mac")).toBe("⌘⇧Tab");
  });
});
