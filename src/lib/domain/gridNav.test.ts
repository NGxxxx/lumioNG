import { describe, it, expect } from "vitest";
import { moveCursor, extendTo, toggleAt, jumpTo, type NavState } from "./gridNav";

const empty = (): NavState => ({ cursor: null, anchor: null, selected: new Set() });

describe("moveCursor", () => {
  it("from null goes to 0 on positive delta, last on negative", () => {
    expect(moveCursor(empty(), 1, 10).cursor).toBe(0);
    expect(moveCursor(empty(), -1, 10).cursor).toBe(9);
  });
  it("single-selects the new cursor", () => {
    const s = moveCursor({ cursor: 2, anchor: 0, selected: new Set([0, 1, 2]) }, 1, 10);
    expect(s).toEqual({ cursor: 3, anchor: 3, selected: new Set([3]) });
  });
  it("clamps at both ends", () => {
    expect(moveCursor({ cursor: 0, anchor: 0, selected: new Set([0]) }, -1, 5).cursor).toBe(0);
    expect(moveCursor({ cursor: 4, anchor: 4, selected: new Set([4]) }, 3, 5).cursor).toBe(4);
  });
  it("empty grid returns state unchanged with null cursor", () => {
    const s = empty();
    const r = moveCursor(s, 1, 0);
    expect(r).toEqual(s);
    expect(r.cursor).toBeNull();
  });
  it("does not mutate input", () => {
    const sel = new Set([1]);
    const s: NavState = { cursor: 1, anchor: 1, selected: sel };
    moveCursor(s, 1, 5);
    expect(s).toEqual({ cursor: 1, anchor: 1, selected: new Set([1]) });
    expect(sel).toEqual(new Set([1]));
  });
});

describe("extendTo", () => {
  const from2: NavState = { cursor: 2, anchor: 2, selected: new Set([2]) };
  it("selects inclusive range forwards", () => {
    const r = extendTo(from2, 5, 10);
    expect(r.selected).toEqual(new Set([2, 3, 4, 5]));
    expect(r.cursor).toBe(5);
    expect(r.anchor).toBe(2);
  });
  it("selects the same range backwards", () => {
    const from5: NavState = { cursor: 5, anchor: 5, selected: new Set([5]) };
    expect(extendTo(from5, 2, 10).selected).toEqual(new Set([2, 3, 4, 5]));
  });
  it("null anchor starts at pos; clamps; empty grid unchanged", () => {
    expect(extendTo(empty(), 3, 10).selected).toEqual(new Set([3]));
    expect(extendTo(from2, 99, 4).cursor).toBe(3);
    expect(extendTo(empty(), 1, 0)).toEqual(empty());
  });
  it("does not mutate input", () => {
    extendTo(from2, 5, 10);
    expect(from2.selected).toEqual(new Set([2]));
  });
});

describe("toggleAt", () => {
  it("adds, sets cursor, keeps others", () => {
    const r = toggleAt({ cursor: 1, anchor: 1, selected: new Set([1]) }, 4);
    expect(r.selected).toEqual(new Set([1, 4]));
    expect(r.cursor).toBe(4);
  });
  it("twice restores selection", () => {
    const s: NavState = { cursor: 1, anchor: 1, selected: new Set([1]) };
    expect(toggleAt(toggleAt(s, 4), 4).selected).toEqual(s.selected);
  });
  it("does not mutate input", () => {
    const s: NavState = { cursor: 1, anchor: 1, selected: new Set([1]) };
    toggleAt(s, 4);
    expect(s.selected).toEqual(new Set([1]));
  });
});

describe("jumpTo", () => {
  it("single-selects and clamps", () => {
    expect(jumpTo(empty(), 99, 10)).toEqual({ cursor: 9, anchor: 9, selected: new Set([9]) });
    expect(jumpTo(empty(), -5, 10).cursor).toBe(0);
  });
  it("empty grid unchanged", () => {
    expect(jumpTo(empty(), 3, 0)).toEqual(empty());
  });
});
