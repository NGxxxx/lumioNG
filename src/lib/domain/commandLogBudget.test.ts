import { describe, it, expect } from "vitest";
import { clipText, enforceBudget, type BudgetEntry } from "./commandLogBudget";

const e = (n: number, clipped = false): BudgetEntry => ({ text: "x".repeat(n), length: n, clipped });

describe("enforceBudget", () => {
  it("leaves everything whole while under budget", () => {
    const list = [e(100), e(200)];
    expect(enforceBudget(list, 1000, 10)).toBe(list);
  });

  it("clips the oldest entries first, only as far as needed", () => {
    const list = [e(500), e(500), e(500)];
    const out = enforceBudget(list, 1100, 10);
    expect(out.map((x) => [x.text.length, x.clipped])).toEqual([[10, true], [500, false], [500, false]]);
    expect(out[2]).toBe(list[2]);
    expect(out[0].length).toBe(500); // the full length is still known
  });

  it("skips entries already at preview size and keeps going", () => {
    const out = enforceBudget([e(5), e(500), e(500)], 600, 10);
    expect(out.map((x) => x.text.length)).toEqual([5, 10, 500]);
  });

  it("may clip the newest entry too when it alone is over budget", () => {
    expect(enforceBudget([e(5000)], 1000, 10)[0].text.length).toBe(10);
  });
});

describe("clipText", () => {
  it("keeps short text and cuts long text to the preview", () => {
    expect(clipText("abc", 10)).toBe("abc");
    expect(clipText("abcdef", 3)).toBe("abc");
  });
});
