import { describe, it, expect } from "vitest";
import { SHORTCUTS, COMMAND_SCOPE, shortcutsByScope, type CommandScope, type CommandId } from "./commands";

describe("commands", () => {
  it("has a scope entry for every command that has a shortcut", () => {
    for (const id of Object.keys(SHORTCUTS) as CommandId[]) {
      expect(COMMAND_SCOPE[id]).toBeDefined();
    }
  });

  it("never binds the same shortcut twice within the same scope", () => {
    const scopes: CommandScope[] = ["global", "grid", "editor"];
    for (const scope of scopes) {
      const entries = shortcutsByScope(scope);
      const seen = new Map<string, CommandId>();
      for (const { id, shortcut } of entries) {
        const dupOf = seen.get(shortcut);
        expect(dupOf, `"${shortcut}" bound to both "${dupOf}" and "${id}" in scope "${scope}"`).toBeUndefined();
        seen.set(shortcut, id);
      }
    }
  });

  it("deliberately reuses Mod+F across the grid and editor scopes", () => {
    expect(SHORTCUTS["grid.focusFilter"]).toBe("Mod+F");
    expect(SHORTCUTS["editor.find"]).toBe("Mod+F");
  });

  it("shortcutsByScope only returns commands from the requested scope", () => {
    const gridEntries = shortcutsByScope("grid");
    for (const { id } of gridEntries) {
      expect(COMMAND_SCOPE[id]).toBe("grid");
    }
    expect(gridEntries.length).toBeGreaterThan(0);
  });

  it("has the three shortcut-less menu commands registered with no bound shortcut", () => {
    expect(COMMAND_SCOPE["file.sessionManager"]).toBe("global");
    expect(COMMAND_SCOPE["file.quit"]).toBe("global");
    expect(COMMAND_SCOPE["view.resetToDefault"]).toBe("global");
    expect(SHORTCUTS["file.sessionManager"]).toBeUndefined();
    expect(SHORTCUTS["file.quit"]).toBeUndefined();
    expect(SHORTCUTS["view.resetToDefault"]).toBeUndefined();
  });
});
