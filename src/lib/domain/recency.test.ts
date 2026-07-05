import { describe, it, expect } from "vitest";
import { relativeParts, sortByRecency } from "./recency";

describe("relativeParts", () => {
  const now = Date.parse("2026-07-05T12:00:00Z");

  it("picks seconds under a minute", () => {
    expect(relativeParts(now - 30_000, now)).toEqual({ value: -30, unit: "second" });
  });

  it("picks minutes under an hour", () => {
    expect(relativeParts(now - 5 * 60_000, now)).toEqual({ value: -5, unit: "minute" });
  });

  it("picks hours under a day", () => {
    expect(relativeParts(now - 3 * 3_600_000, now)).toEqual({ value: -3, unit: "hour" });
  });

  it("picks days under a month", () => {
    expect(relativeParts(now - 2 * 86_400_000, now)).toEqual({ value: -2, unit: "day" });
  });

  it("picks months under a year", () => {
    expect(relativeParts(now - 60 * 86_400_000, now)).toEqual({ value: -2, unit: "month" });
  });

  it("picks years beyond that", () => {
    expect(relativeParts(now - 400 * 86_400_000, now)).toEqual({ value: -1, unit: "year" });
  });
});

describe("sortByRecency", () => {
  it("sorts descending by lastConnectedAt", () => {
    const list = [{ id: 1, lastConnectedAt: 100 }, { id: 2, lastConnectedAt: 300 }, { id: 3, lastConnectedAt: 200 }];
    expect(sortByRecency(list).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("sinks never-connected entries to the end, preserving their relative order", () => {
    const list = [
      { id: 1, lastConnectedAt: null },
      { id: 2, lastConnectedAt: 100 },
      { id: 3, lastConnectedAt: undefined },
    ];
    expect(sortByRecency(list).map((c) => c.id)).toEqual([2, 1, 3]);
  });

  it("does not mutate the input array", () => {
    const list = [{ id: 1, lastConnectedAt: 1 }, { id: 2, lastConnectedAt: 2 }];
    const sorted = sortByRecency(list);
    expect(sorted).not.toBe(list);
    expect(list.map((c) => c.id)).toEqual([1, 2]);
  });
});
