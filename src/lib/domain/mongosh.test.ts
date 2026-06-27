import { describe, it, expect } from "vitest";
import { aggregateCmd, distinctCmd, insertManyCmd, updateOneCmd, replaceOneFilterCmd, deleteOneFilterCmd } from "./mongosh";

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

describe("write command-log helpers", () => {
  it("insertManyCmd", () => {
    expect(insertManyCmd("c", '[{ "a": 1 }]')).toBe('db.getCollection("c").insertMany([{ "a": 1 }])');
  });
  it("updateOneCmd", () => {
    expect(updateOneCmd("c", '{ "a": 1 }', '{ "$set": { "b": 2 } }')).toBe(
      'db.getCollection("c").updateOne({ "a": 1 }, { "$set": { "b": 2 } })',
    );
  });
  it("replaceOneFilterCmd", () => {
    expect(replaceOneFilterCmd("c", '{ "a": 1 }', '{ "a": 2 }')).toBe(
      'db.getCollection("c").replaceOne({ "a": 1 }, { "a": 2 })',
    );
  });
  it("deleteOneFilterCmd", () => {
    expect(deleteOneFilterCmd("c", '{ "a": 1 }')).toBe('db.getCollection("c").deleteOne({ "a": 1 })');
  });
});
