import { describe, it, expect } from "vitest";
import { aggregateCmd, distinctCmd } from "./mongosh";

describe("aggregateCmd", () => {
  it("wraps the pipeline in db.getCollection(...).aggregate(...)", () => {
    expect(aggregateCmd("orders", '[{ "$match": {} }]')).toBe(
      'db.getCollection("orders").aggregate([{ "$match": {} }])',
    );
  });
});

describe("distinctCmd", () => {
  it("omits the filter when empty", () => {
    expect(distinctCmd("orders", "status", "{}")).toBe('db.getCollection("orders").distinct("status")');
  });
  it("includes a non-empty filter", () => {
    expect(distinctCmd("orders", "status", '{ "a": 1 }')).toBe(
      'db.getCollection("orders").distinct("status", { "a": 1 })',
    );
  });
  it("quotes a field containing a quote", () => {
    expect(distinctCmd("c", 'a"b', "{}")).toBe('db.getCollection("c").distinct("a\\"b")');
  });
});
