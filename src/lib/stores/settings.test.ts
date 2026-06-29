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
});
