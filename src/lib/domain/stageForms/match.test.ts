import { describe, it, expect } from "vitest";
import { STAGE_CODECS } from "./index";
import { deepEqualOrdered } from "./deepEqualOrdered";

const c = STAGE_CODECS["$match"];

describe("$match codec", () => {
  it("round-trips chip-representable bodies", () => {
    for (const b of [{}, { status: "shipped" }, { total: { $gt: 100 }, status: { $in: ["a", "b"] } }]) {
      const m = c.parse(b);
      expect(m).not.toBeNull();
      expect(deepEqualOrdered(c.build(m), b)).toBe(true);
    }
  });
  it("rejects what chips can't express", () => {
    expect(c.parse({ $expr: { $gt: ["$a", "$b"] } })).toBeNull();
    expect(c.parse({ $or: [{ a: 1 }, { b: 2 }] })).toBeNull();
    expect(c.parse([1])).toBeNull();
  });
  it("summarizes in words", () => {
    expect(c.summarize(c.parse({ status: "shipped", total: { $gt: 100 } }))).toBe("status = shipped, total > 100");
    expect(c.summarize(c.parse({}))).toBe("all documents");
  });
});
