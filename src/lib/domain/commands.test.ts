import { describe, it, expect } from "vitest";
import { SHORTCUTS } from "./commands";

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
});
