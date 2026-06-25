import { describe, it, expect } from "vitest";
import { SESSION_COLORS, savedSessionId, adhocSessionId, allocColor, adhocLabel } from "./session";

describe("session helpers", () => {
  it("builds stable ids", () => {
    expect(savedSessionId(7)).toBe("conn:7");
    expect(adhocSessionId(2)).toBe("adhoc:2");
  });

  it("labels ad-hoc sessions", () => {
    expect(adhocLabel(3)).toBe("Session #3");
  });

  it("allocates the first free color", () => {
    expect(allocColor([])).toBe(SESSION_COLORS[0]);
    expect(allocColor([SESSION_COLORS[0]])).toBe(SESSION_COLORS[1]);
    expect(allocColor([SESSION_COLORS[1]])).toBe(SESSION_COLORS[0]);
  });

  it("wraps when the palette is exhausted", () => {
    const all = [...SESSION_COLORS];
    expect(allocColor(all)).toBe(SESSION_COLORS[0]);
  });
});
