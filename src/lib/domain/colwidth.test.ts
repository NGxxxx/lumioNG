import { describe, it, expect } from "vitest";
import { clampWidth, computeColumnWidths, COLWIDTH_SAMPLE, MIN_COL_W, MAX_COL_W } from "./colwidth";
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
