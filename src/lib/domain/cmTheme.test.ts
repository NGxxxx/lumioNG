import { describe, expect, it } from "vitest";
import { appEditorTheme } from "./cmTheme";

describe("appEditorTheme", () => {
  // CodeMirror rejects some selectors (e.g. `&light`, base-theme only) when the theme is built,
  // which would take every editor down with it.
  it("builds without throwing", () => {
    expect(appEditorTheme().length).toBeGreaterThan(0);
  });
});
