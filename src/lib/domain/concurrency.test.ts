import { describe, expect, it } from "vitest";
import { forEachLimit } from "./concurrency";

describe("forEachLimit", () => {
  it("visits every item once and never exceeds the limit", async () => {
    let inFlight = 0, peak = 0;
    const seen: number[] = [];
    await forEachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      inFlight--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("does nothing for an empty list", async () => {
    let calls = 0;
    await forEachLimit([], 4, async () => { calls++; });
    expect(calls).toBe(0);
  });
});
