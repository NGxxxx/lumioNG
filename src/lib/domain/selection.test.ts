import { describe, it, expect } from "vitest";
import { rangeBetween, idInFilter, resolveIds, effectiveRows } from "./selection";

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

describe("resolveIds", () => {
  const docs = [{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { x: 1 }];

  it("resolves selected rows to id ExtJSON in iteration order", () =>
    expect(resolveIds(docs, [0, 1])).toEqual({ ids: ['{"$oid":"a"}', '{"$oid":"b"}'] }));

  it("reports missing as soon as a row lacks _id", () =>
    expect(resolveIds(docs, [0, 2])).toEqual({ missing: true }));

  it("accepts a Set of indices", () =>
    expect(resolveIds(docs, new Set([1]))).toEqual({ ids: ['{"$oid":"b"}'] }));

  it("empty selection yields empty ids", () =>
    expect(resolveIds(docs, [])).toEqual({ ids: [] }));
});

describe("effectiveRows", () => {
  it("no menu open → returns the current selection", () =>
    expect(effectiveRows(null, new Set([1, 2])).sort()).toEqual([1, 2]));

  it("menu row in selection → keeps the whole selection", () =>
    expect(effectiveRows(0, new Set([0, 2])).sort()).toEqual([0, 2]));

  it("menu row outside selection → just the menu row", () =>
    expect(effectiveRows(3, new Set([0, 2]))).toEqual([3]));
});
