import { describe, it, expect } from "vitest";
import { aggregateCmd } from "./mongosh";

describe("aggregateCmd", () => {
  it("wraps the pipeline in db.getCollection(...).aggregate(...)", () => {
    expect(aggregateCmd("orders", '[{ "$match": {} }]')).toBe(
      'db.getCollection("orders").aggregate([{ "$match": {} }])',
    );
  });
});
