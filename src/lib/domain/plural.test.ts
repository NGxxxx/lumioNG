import { describe, it, expect } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("picks one for exactly 1, other otherwise", () => {
    expect(plural(1, () => "a", () => "b")).toBe("a");
    expect(plural(0, () => "a", () => "b")).toBe("b");
    expect(plural(2, () => "a", () => "b")).toBe("b");
  });
});
