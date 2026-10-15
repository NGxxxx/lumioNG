import { describe, it, expect } from "vitest";
import { matchesEvent, formatCombo, isDefaultWebviewAccelerator, blocksNativeSelectAll } from "./shortcuts";

function evt(partial: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget | null;
}): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...partial,
  } as unknown as KeyboardEvent;
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

  it("does not match when the event has no key (e.g. some IME-synthesized events)", () => {
    expect(matchesEvent("Mod+S", evt({ key: undefined as unknown as string, ctrlKey: true }), "other")).toBe(
      false,
    );
  });

  it("matches single-character keys like Insert/Delete/Escape by name", () => {
    expect(matchesEvent("Insert", evt({ key: "Insert" }), "other")).toBe(true);
    expect(matchesEvent("Mod+Delete", evt({ key: "Delete", ctrlKey: true }), "other")).toBe(true);
    expect(matchesEvent("Escape", evt({ key: "Escape" }), "other")).toBe(true);
  });
});

describe("isDefaultWebviewAccelerator", () => {
  it("blocks reload, devtools, print, and find-on-page on Windows/Linux (Ctrl)", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "F5" }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "r", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "F12" }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "i", ctrlKey: true, shiftKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "p", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "f", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "F3" }), "other")).toBe(true);
  });

  it("resolves Mod to Cmd on mac, same as the app's own shortcuts", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "r", ctrlKey: true }), "mac")).toBe(false);
    expect(isDefaultWebviewAccelerator(evt({ key: "r", metaKey: true }), "mac")).toBe(true);
  });

  it("blocks history navigation (Alt+Left/Right)", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "ArrowLeft", altKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "ArrowRight", altKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "ArrowLeft" }), "other")).toBe(false);
  });

  it("blocks zoom regardless of the exact +/- key reported (Shift changes '=' to '+')", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "=", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "+", ctrlKey: true, shiftKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "-", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "0", ctrlKey: true }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "0", metaKey: true }), "other")).toBe(false); // wrong modifier for this platform
  });

  it("blocks plain Backspace outside an editable field (history-back), but never inside one", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "Backspace" }), "other")).toBe(true);
    expect(isDefaultWebviewAccelerator(evt({ key: "Backspace", target: document.createElement("input") }), "other")).toBe(false);
    expect(isDefaultWebviewAccelerator(evt({ key: "Backspace", target: document.createElement("textarea") }), "other")).toBe(false);
    const editableDiv = document.createElement("div");
    Object.defineProperty(editableDiv, "isContentEditable", { value: true });
    expect(isDefaultWebviewAccelerator(evt({ key: "Backspace", target: editableDiv }), "other")).toBe(false);
  });

  it("does not block Backspace combined with a modifier (not the plain history-back binding)", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "Backspace", shiftKey: true }), "other")).toBe(false);
  });

  it("does not block ordinary typing/navigation keys", () => {
    expect(isDefaultWebviewAccelerator(evt({ key: "a" }), "other")).toBe(false);
    expect(isDefaultWebviewAccelerator(evt({ key: "Enter" }), "other")).toBe(false);
    expect(isDefaultWebviewAccelerator(evt({ key: "s", ctrlKey: true, altKey: true }), "other")).toBe(false);
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

describe("matchesEvent with Alt-modified characters", () => {
  const ev = (o: Partial<KeyboardEvent>) => ({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;
  it("matches by physical key when Alt changes the character (mac Option, AltGr)", () => {
    expect(matchesEvent("Mod+Alt+A", ev({ key: "å", code: "KeyA", metaKey: true, altKey: true }), "mac")).toBe(true);
    expect(matchesEvent("Mod+Alt+A", ev({ key: "ą", code: "KeyA", ctrlKey: true, altKey: true }), "other")).toBe(true);
  });
  it("still requires the right modifiers", () => {
    expect(matchesEvent("Mod+Alt+A", ev({ key: "å", code: "KeyA", altKey: true }), "other")).toBe(false);
  });
});

describe("blocksNativeSelectAll", () => {
  const ev = (o: Partial<KeyboardEvent>, tag = "DIV") =>
    ({ key: "a", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: { tagName: tag, isContentEditable: false }, ...o }) as unknown as KeyboardEvent;
  it("blocks plain Mod+A outside editable fields", () => {
    expect(blocksNativeSelectAll(ev({ ctrlKey: true }))).toBe(true);
    expect(blocksNativeSelectAll(ev({ ctrlKey: true }, "INPUT"))).toBe(false);
  });
  it("leaves Mod+Alt+A / Mod+Shift+A to the app's shortcuts", () => {
    expect(blocksNativeSelectAll(ev({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(blocksNativeSelectAll(ev({ metaKey: true, shiftKey: true }))).toBe(false);
  });
});

