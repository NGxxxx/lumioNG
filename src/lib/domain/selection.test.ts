import { describe, it, expect } from "vitest";
import { rangeBetween, idInFilter } from "./selection";

describe("rangeBetween", () => {
  it("forward range is inclusive", () => expect(rangeBetween(2, 5)).toEqual([2, 3, 4, 5]));
  it("backward range is normalized ascending", () => expect(rangeBetween(5, 2)).toEqual([2, 3, 4, 5]));
  it("single index", () => expect(rangeBetween(3, 3)).toEqual([3]));
});

describe("idInFilter", () => {
  it("wraps one id in $in", () =>
    expect(idInFilter(['{"$oid":"a"}'])).toBe('{"_id":{"$in":[{"$oid":"a"}]}}'));
  it("preserves multiple ids in order", () =>
    expect(idInFilter(["1", "2", "3"])).toBe('{"_id":{"$in":[1,2,3]}}'));
  it("produces valid JSON", () =>
    expect(() => JSON.parse(idInFilter(['{"$oid":"a"}', '{"$oid":"b"}']))).not.toThrow());
});
