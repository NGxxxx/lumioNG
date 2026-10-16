import { describe, it, expect } from "vitest";
import { clampWidth, columnWindow, computeColumnWidths, pinnedOffsets, COLWIDTH_SAMPLE, MIN_COL_W, MAX_COL_W, pinnedFirst } from "./colwidth";
import type { ColumnField } from "./schema";
import type { Doc } from "./doc";

describe("clampWidth", () => {
  it("clamps below MIN up to MIN", () => {
    expect(clampWidth(10)).toBe(MIN_COL_W);
  });
  it("clamps above MAX down to MAX", () => {
    expect(clampWidth(10000)).toBe(MAX_COL_W);
  });
  it("rounds and passes through in-range", () => {
    expect(clampWidth(100.4)).toBe(100);
  });
});

describe("computeColumnWidths", () => {
  it("content longer than header drives the width", () => {
    const fields: ColumnField[] = [{ path: "name", type: "string" }];
    const docs: Doc[] = [{ name: "Alice" }, { name: "a much longer display value" }];
    // content len 27 > header (4 + 6 badge) = 10 → 27*7+20 = 209
    expect(computeColumnWidths(fields, docs).name).toBe(209);
  });
  it("header label drives width when content is short", () => {
    const fields: ColumnField[] = [{ path: "description", type: "string" }];
    const docs: Doc[] = [{ description: "x" }];
    // header 11 + 6 = 17 > content 1 → 17*7+20 = 139
    expect(computeColumnWidths(fields, docs).description).toBe(139);
  });
  it("empty docs → header-only, clamped to MIN", () => {
    const fields: ColumnField[] = [{ path: "id" }]; // no type → no badge allowance
    // header 2 → 2*7+20 = 34 → clamp MIN 48
    expect(computeColumnWidths(fields, []).id).toBe(MIN_COL_W);
  });
  it("very long content is capped at MAX", () => {
    const fields: ColumnField[] = [{ path: "blob" }];
    const docs: Doc[] = [{ blob: "x".repeat(200) }];
    expect(computeColumnWidths(fields, docs).blob).toBe(MAX_COL_W);
  });
  it("missing values do not count toward content length", () => {
    const fields: ColumnField[] = [{ path: "maybe" }];
    const docs: Doc[] = [{ other: 1 }, { maybe: "hi" }]; // only 'hi' (len 2) counts
    // header 5 vs content 2 → header wins → 5*7+20 = 55
    expect(computeColumnWidths(fields, docs).maybe).toBe(55);
  });
  it("scans only the first COLWIDTH_SAMPLE docs for content width", () => {
    const fields: ColumnField[] = [{ path: "v" }];
    const docs: Doc[] = [];
    for (let i = 0; i < COLWIDTH_SAMPLE; i++) docs.push({ v: "x" }); // short, within sample
    docs.push({ v: "y".repeat(300) }); // long, just past the sample → must be ignored
    // header "v" (1) ≥ sampled content (1) → 1*7+20 = 27 → clamp to MIN; a full scan would hit MAX
    expect(computeColumnWidths(fields, docs).v).toBe(MIN_COL_W);
  });
});

describe("pinnedOffsets", () => {
  it("single pinned column starts after the row-number column", () => {
    expect(pinnedOffsets(["a", "b", "c"], { a: 100, b: 50 }, new Set(["b"]), 42, 160)).toEqual({ b: 42 });
  });
  it("second pinned offset = rownum + first width, in display order", () => {
    expect(pinnedOffsets(["a", "b", "c"], { a: 100, b: 50, c: 70 }, new Set(["c", "a"]), 42, 160)).toEqual({ a: 42, c: 142 });
  });
  it("missing width uses fallback", () => {
    expect(pinnedOffsets(["a", "b"], {}, new Set(["a", "b"]), 10, 160)).toEqual({ a: 10, b: 170 });
  });
  it("nothing pinned → {}", () => {
    expect(pinnedOffsets(["a"], {}, new Set(), 42, 160)).toEqual({});
  });
});

describe("pinnedFirst", () => {
  it("moves pinned columns to the front, keeping relative order on both sides", () => {
    const cols = [{ path: "a" }, { path: "b" }, { path: "c" }, { path: "d" }];
    expect(pinnedFirst(cols, new Set(["c", "a"])).map((c) => c.path)).toEqual(["a", "c", "b", "d"]);
  });
  it("returns the same order when nothing is pinned", () => {
    const cols = [{ path: "a" }, { path: "b" }];
    expect(pinnedFirst(cols, new Set()).map((c) => c.path)).toEqual(["a", "b"]);
  });
});

describe("columnWindow", () => {
  const w = Array(100).fill(100); // 100 columns, 100px each → 10,000px

  it("returns the columns overlapping the viewport plus overscan, with spacer widths for the rest", () => {
    // viewport [1000, 1500) → columns 10..14; overscan 200px adds 2 each side → 8..16
    expect(columnWindow(w, 1000, 500, 200)).toEqual({ start: 8, end: 17, before: 800, after: 8300 });
  });

  it("clamps at both edges", () => {
    expect(columnWindow(w, 0, 300, 100)).toEqual({ start: 0, end: 4, before: 0, after: 9600 });
    expect(columnWindow(w, 9800, 300, 100)).toEqual({ start: 97, end: 100, before: 9700, after: 0 });
  });

  it("treats a negative scroll offset (content still left of the free area) as 0", () => {
    expect(columnWindow(w, -250, 300, 0)).toEqual({ start: 0, end: 1, before: 0, after: 9900 });
  });

  it("widens the window to keep a must-render column (e.g. the one being edited)", () => {
    expect(columnWindow(w, 1000, 500, 0, 2)).toEqual({ start: 2, end: 15, before: 200, after: 8500 });
    expect(columnWindow(w, 1000, 500, 0, 50)).toEqual({ start: 10, end: 51, before: 1000, after: 4900 });
  });

  it("handles uneven widths", () => {
    expect(columnWindow([50, 300, 50, 50], 60, 100, 0)).toEqual({ start: 1, end: 2, before: 50, after: 100 });
  });

  it("an empty column list is an empty window", () => {
    expect(columnWindow([], 0, 500, 100)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
