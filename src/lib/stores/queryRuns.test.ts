import { describe, it, expect } from "vitest";
import { getQueryRun, disposeQueryRun } from "./queryRuns.svelte";

describe("queryRuns registry", () => {
  it("returns the same store instance for one id and ignores the seed on repeat", () => {
    const a = getQueryRun(101, 'db.getCollection("x").aggregate([])');
    const b = getQueryRun(101, "different seed");
    expect(b).toBe(a);
    disposeQueryRun(101);
  });

  it("returns distinct stores per id", () => {
    const a = getQueryRun(102, "a");
    const c = getQueryRun(103, "c");
    expect(c).not.toBe(a);
    disposeQueryRun(102);
    disposeQueryRun(103);
  });

  it("dispose drops the entry so the next get creates a fresh store with the new seed", () => {
    const first = getQueryRun(104, "first");
    expect(first.statementText).toBe("first");
    disposeQueryRun(104);
    const second = getQueryRun(104, "second");
    expect(second).not.toBe(first);
    expect(second.statementText).toBe("second");
    disposeQueryRun(104);
  });
});
