import { describe, it, expect } from "vitest";
import { pageCount, clampPage, skipFor, pageSlice } from "./paging";

describe("pageCount", () => {
  it("total 0 → 1 page", () => expect(pageCount(0, 50)).toBe(1));
  it("evenly divisible → exact page count", () => expect(pageCount(100, 50)).toBe(2));
  it("remainder → rounds up", () => expect(pageCount(101, 50)).toBe(3));
  it("exactly one page", () => expect(pageCount(50, 50)).toBe(1));
  it("size <= 0 → 1", () => expect(pageCount(100, 0)).toBe(1));
});

describe("clampPage", () => {
  it("below 1 → 1", () => expect(clampPage(0, 5)).toBe(1));
  it("above count → count", () => expect(clampPage(6, 5)).toBe(5));
  it("in range → unchanged", () => expect(clampPage(3, 5)).toBe(3));
  it("NaN → 1", () => expect(clampPage(Number.NaN, 5)).toBe(1));
});

describe("skipFor", () => {
  it("page 1 → 0", () => expect(skipFor(1, 50)).toBe(0));
  it("page 3 size 50 → 100", () => expect(skipFor(3, 50)).toBe(100));
});

describe("pageSlice", () => {
  const rows = [1, 2, 3, 4, 5];
  it("first page", () => expect(pageSlice(rows, 1, 2)).toEqual([1, 2]));
  it("middle page", () => expect(pageSlice(rows, 2, 2)).toEqual([3, 4]));
  it("short last page", () => expect(pageSlice(rows, 3, 2)).toEqual([5]));
  it("past the end → empty", () => expect(pageSlice(rows, 4, 2)).toEqual([]));
});
