import { describe, it, expect } from "vitest";
import { pageCount, clampPage, skipFor } from "./paging";

describe("pageCount", () => {
  it("total 0 → 1 trang", () => expect(pageCount(0, 50)).toBe(1));
  it("chia hết → đúng số trang", () => expect(pageCount(100, 50)).toBe(2));
  it("lẻ → làm tròn lên", () => expect(pageCount(101, 50)).toBe(3));
  it("đúng một trang", () => expect(pageCount(50, 50)).toBe(1));
  it("size <= 0 → 1", () => expect(pageCount(100, 0)).toBe(1));
});

describe("clampPage", () => {
  it("dưới 1 → 1", () => expect(clampPage(0, 5)).toBe(1));
  it("vượt count → count", () => expect(clampPage(6, 5)).toBe(5));
  it("trong khoảng → giữ", () => expect(clampPage(3, 5)).toBe(3));
  it("NaN → 1", () => expect(clampPage(Number.NaN, 5)).toBe(1));
});

describe("skipFor", () => {
  it("trang 1 → 0", () => expect(skipFor(1, 50)).toBe(0));
  it("trang 3 size 50 → 100", () => expect(skipFor(3, 50)).toBe(100));
});
