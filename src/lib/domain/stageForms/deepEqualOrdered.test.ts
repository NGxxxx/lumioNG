import { describe, expect, it } from "vitest";
import { deepEqualOrdered } from "./deepEqualOrdered";

describe("deepEqualOrdered", () => {
  it("equal values", () => {
    expect(deepEqualOrdered({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqualOrdered(null, null)).toBe(true);
  });
  it("key order matters", () => {
    expect(deepEqualOrdered({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
    expect(deepEqualOrdered({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } })).toBe(false);
  });
  it("differences", () => {
    expect(deepEqualOrdered([1], [1, 2])).toBe(false);
    expect(deepEqualOrdered({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqualOrdered([], {})).toBe(false);
    expect(deepEqualOrdered(1, "1")).toBe(false);
  });
});
