import { describe, it, expect } from "vitest";
import { aggregateTemplate, parseAggregateStatement, pipelineHasTrailingLimit } from "./aggregate";

describe("aggregateTemplate", () => {
  it("builds a full statement with the collection", () => {
    expect(aggregateTemplate("movies")).toBe(
      'db.getCollection("movies").aggregate([\n  { "$match": {} }\n])',
    );
  });
  it("uses an empty collection name for the blank template", () => {
    expect(aggregateTemplate("")).toContain('db.getCollection("").aggregate(');
  });
});

describe("parseAggregateStatement", () => {
  it("extracts collection and pipeline from getCollection form (multi-line)", () => {
    const { coll, pipelineText } = parseAggregateStatement(
      'db.getCollection("movies").aggregate([\n  { "$match": { "year": 1999 } }\n])',
    );
    expect(coll).toBe("movies");
    expect(pipelineText.trim()).toBe('[\n  { "$match": { "year": 1999 } }\n]');
  });
  it("accepts the db.<name>.aggregate form and a trailing semicolon", () => {
    const { coll, pipelineText } = parseAggregateStatement("db.orders.aggregate([{ \"$count\": \"n\" }]);");
    expect(coll).toBe("orders");
    expect(pipelineText.trim()).toBe('[{ "$count": "n" }]');
  });
  it("throws when aggregate(...) is missing", () => {
    expect(() => parseAggregateStatement('db.getCollection("x").find({})')).toThrow();
  });
  it("throws when the collection name is empty", () => {
    expect(() => parseAggregateStatement('db.getCollection("").aggregate([])')).toThrow();
  });
});

describe("pipelineHasTrailingLimit", () => {
  it("true when last stage is $limit", () => {
    expect(pipelineHasTrailingLimit('[{ "$match": {} }, { "$limit": 10 }]')).toBe(true);
  });
  it("false when no trailing $limit", () => {
    expect(pipelineHasTrailingLimit('[{ "$match": {} }]')).toBe(false);
  });
  it("false when the pipeline cannot be parsed", () => {
    expect(pipelineHasTrailingLimit("[{ not json")).toBe(false);
  });
});
