import { describe, it, expect } from "vitest";
import { nextQuerySeq } from "./queryseq";

describe("nextQuerySeq", () => {
  it("returns 1 when none are used", () => {
    expect(nextQuerySeq([])).toBe(1);
  });
  it("fills the lowest gap", () => {
    expect(nextQuerySeq([1, 2, 4])).toBe(3);
  });
  it("returns max+1 when contiguous", () => {
    expect(nextQuerySeq([1, 2, 3])).toBe(4);
  });
  it("reuses a freed low number", () => {
    expect(nextQuerySeq([2, 3])).toBe(1);
  });
});
