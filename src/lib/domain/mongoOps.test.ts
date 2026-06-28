import { describe, it, expect } from "vitest";
import { PIPELINE_STAGES, QUERY_OPERATORS, EXPR_OPERATORS, COLLECTION_METHODS, type OpEntry } from "./mongoOps";

const allDollar = (xs: readonly OpEntry[]) => xs.every((x) => x.label.startsWith("$"));
const unique = (xs: readonly OpEntry[]) => new Set(xs.map((x) => x.label)).size === xs.length;

describe("mongoOps catalogs", () => {
  it("are non-empty", () => {
    expect(PIPELINE_STAGES.length).toBeGreaterThan(0);
    expect(QUERY_OPERATORS.length).toBeGreaterThan(0);
    expect(EXPR_OPERATORS.length).toBeGreaterThan(0);
  });
  it("every label is $-prefixed", () => {
    expect(allDollar(PIPELINE_STAGES)).toBe(true);
    expect(allDollar(QUERY_OPERATORS)).toBe(true);
    expect(allDollar(EXPR_OPERATORS)).toBe(true);
  });
  it("labels are unique within each catalog", () => {
    expect(unique(PIPELINE_STAGES)).toBe(true);
    expect(unique(QUERY_OPERATORS)).toBe(true);
    expect(unique(EXPR_OPERATORS)).toBe(true);
  });
  it("includes the common stages and operators", () => {
    expect(PIPELINE_STAGES.map((s) => s.label)).toEqual(expect.arrayContaining(["$match", "$group", "$lookup"]));
    expect(QUERY_OPERATORS.map((s) => s.label)).toEqual(expect.arrayContaining(["$gte", "$in", "$or"]));
    expect(EXPR_OPERATORS.map((s) => s.label)).toEqual(expect.arrayContaining(["$sum", "$cond"]));
  });
});

describe("COLLECTION_METHODS catalog", () => {
  it("is non-empty and labels are unique", () => {
    expect(COLLECTION_METHODS.length).toBeGreaterThan(0);
    expect(unique(COLLECTION_METHODS)).toBe(true);
  });
  it("has no $-prefixed labels (these are method names, not operators)", () => {
    expect(COLLECTION_METHODS.every((m) => !m.label.startsWith("$"))).toBe(true);
  });
  it("includes the executable methods and omits the deprecated count alias", () => {
    const labels = COLLECTION_METHODS.map((m) => m.label);
    expect(labels).toEqual(
      expect.arrayContaining(["find", "aggregate", "countDocuments", "distinct", "insertOne", "deleteMany"]),
    );
    expect(labels).not.toContain("count");
  });
});
