import { describe, it, expect } from "vitest";
import { rangeBetween, idInFilter, resolveIds, effectiveRows, clickRowSelection, selectForMenu } from "./selection";

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

describe("clickRowSelection", () => {
  const none = { selected: new Set<number>(), anchor: null };

  it("plain click selects only that row and becomes the anchor", () => {
    const r = clickRowSelection(none, 2, { ctrl: false, shift: false }, null);
    expect(r).toEqual({ selected: new Set([2]), anchor: 2 });
  });

  it("ctrl-click toggles the row into the selection without moving anchor semantics", () => {
    const r = clickRowSelection({ selected: new Set([1]), anchor: 1 }, 3, { ctrl: true, shift: false }, null);
    expect(r.selected).toEqual(new Set([1, 3]));
    expect(r.anchor).toBe(3);
  });

  it("ctrl-click on an already-selected row removes it", () => {
    const r = clickRowSelection({ selected: new Set([1, 3]), anchor: 3 }, 3, { ctrl: true, shift: false }, null);
    expect(r.selected).toEqual(new Set([1]));
  });

  it("shift-click with an anchor range-selects between anchor and row", () => {
    const r = clickRowSelection({ selected: new Set([2]), anchor: 2 }, 5, { ctrl: false, shift: true }, null);
    expect(r.selected).toEqual(new Set([2, 3, 4, 5]));
    expect(r.anchor).toBe(2); // anchor unchanged by a shift-range
  });

  it("shift-click without an anchor falls back to a plain single-select", () => {
    const r = clickRowSelection(none, 4, { ctrl: false, shift: true }, null);
    expect(r).toEqual({ selected: new Set([4]), anchor: 4 });
  });

  it("shift-range is clamped to visible rows when a search filter is active", () => {
    const r = clickRowSelection({ selected: new Set([1]), anchor: 1 }, 4, { ctrl: false, shift: true }, [1, 4]);
    expect(r.selected).toEqual(new Set([1, 4])); // 2,3 excluded: filtered out of view
  });
});

describe("selectForMenu", () => {
  it("right-click outside the selection replaces it with just that row", () => {
    const r = selectForMenu({ selected: new Set([1, 2]), anchor: 1 }, 5);
    expect(r).toEqual({ selected: new Set([5]), anchor: 5 });
  });

  it("right-click inside an existing multi-select leaves it untouched", () => {
    const current = { selected: new Set([1, 2, 3]), anchor: 1 };
    expect(selectForMenu(current, 2)).toBe(current);
  });
});
