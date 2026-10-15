import { describe, it, expect } from "vitest";
import { SHORTCUTS, GRID_ALIASES, COMMAND_GROUPS, type CommandId } from "./commands";

describe("commands", () => {
  it("deliberately reuses Mod+F across the grid and editor scopes", () => {
    expect(SHORTCUTS["grid.focusFilter"]).toBe("Mod+F");
    expect(SHORTCUTS["editor.find"]).toBe("Mod+F");
  });

  it("has the three shortcut-less menu commands registered with no bound shortcut", () => {
    expect(SHORTCUTS["file.sessionManager"]).toBeUndefined();
    expect(SHORTCUTS["file.quit"]).toBeUndefined();
    expect(SHORTCUTS["view.resetToDefault"]).toBeUndefined();
  });

  it("binds the command palette to Mod+K", () => {
    expect(SHORTCUTS["view.commandPalette"]).toBe("Mod+K");
  });

  it("renumbers the destination shortcuts: Host, Database, Data, Schema", () => {
    expect(SHORTCUTS["goto.host"]).toBe("Mod+1");
    expect(SHORTCUTS["goto.database"]).toBe("Mod+2");
    expect(SHORTCUTS["goto.data"]).toBe("Mod+3");
    expect(SHORTCUTS["goto.schema"]).toBe("Mod+4");
  });

  it("registers the grid navigation keys, with j/k as aliases of the arrows", () => {
    expect(SHORTCUTS["grid.cursorDown"]).toBe("ArrowDown");
    expect(SHORTCUTS["grid.cursorUp"]).toBe("ArrowUp");
    expect(GRID_ALIASES["grid.cursorDown"]).toEqual(["j"]);
    expect(GRID_ALIASES["grid.cursorUp"]).toEqual(["k"]);
    expect(SHORTCUTS["grid.extendDown"]).toBe("Shift+ArrowDown");
    expect(SHORTCUTS["grid.toggleRow"]).toBe("x");
    expect(SHORTCUTS["grid.peek"]).toBe("Space");
    expect(SHORTCUTS["grid.peekEdit"]).toBe("e");
    expect(SHORTCUTS["grid.prevPage"]).toBe("[");
    expect(SHORTCUTS["grid.nextPage"]).toBe("]");
    expect(SHORTCUTS["grid.slashFilter"]).toBe("/");
    expect(SHORTCUTS["help.shortcuts"]).toBe("?");
  });

  it("COMMAND_GROUPS lists every shortcut exactly once", () => {
    const listed = COMMAND_GROUPS.flatMap((g) => g.ids);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual((Object.keys(SHORTCUTS) as CommandId[]).sort());
    expect(COMMAND_GROUPS.map((g) => g.group)).toEqual(["general", "navigation", "grid", "editor"]);
  });
});
