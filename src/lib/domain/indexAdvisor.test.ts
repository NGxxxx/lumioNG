import { describe, it, expect } from "vitest";
import { suggestIndex } from "./indexAdvisor";

describe("suggestIndex", () => {
  it("equality-only filter suggests a single-field ascending index", () => {
    const s = suggestIndex("orders", '{"status":"pending"}', null);
    expect(s).toEqual({
      keys: { status: 1 },
      snippet: 'db.getCollection("orders").createIndex({"status":1})',
    });
  });

  it("equality + sort suggests equality first, then the sort field/direction", () => {
    const s = suggestIndex("orders", '{"status":"pending"}', '{"createdAt":-1}');
    expect(s?.keys).toEqual({ status: 1, createdAt: -1 });
  });

  it("equality + sort + range orders Equality, Sort, then Range", () => {
    const s = suggestIndex("orders", '{"status":"pending","total":{"$gt":100}}', '{"createdAt":-1}');
    expect(s?.keys).toEqual({ status: 1, createdAt: -1, total: 1 });
  });

  it("sort-only (empty filter) suggests an index on the sort fields", () => {
    const s = suggestIndex("orders", "{}", '{"createdAt":-1}');
    expect(s?.keys).toEqual({ createdAt: -1 });
  });

  it("bails on a top-level $or", () => {
    expect(suggestIndex("orders", '{"$or":[{"a":1},{"b":2}]}', null)).toBeNull();
  });

  it("bails on a top-level $nor", () => {
    expect(suggestIndex("orders", '{"$nor":[{"a":1}]}', null)).toBeNull();
  });

  it("bails on a top-level $and", () => {
    expect(suggestIndex("orders", '{"$and":[{"a":1},{"b":2}]}', null)).toBeNull();
  });

  it("bails on an empty filter with no sort", () => {
    expect(suggestIndex("orders", "{}", null)).toBeNull();
  });

  it("bails on invalid filter JSON", () => {
    expect(suggestIndex("orders", "not json", null)).toBeNull();
  });

  it("dotted field paths pass through unchanged", () => {
    const s = suggestIndex("orders", '{"address.city":"NYC"}', null);
    expect(s?.keys).toEqual({ "address.city": 1 });
  });

  it("treats BSON type-wrapper literals as equality, not range", () => {
    const s = suggestIndex("orders", '{"_id":{"$oid":"507f1f77bcf86cd799439011"}}', null);
    expect(s?.keys).toEqual({ _id: 1 });
  });

  it("treats a range operator ($gt) as range, not equality", () => {
    const s = suggestIndex("orders", '{"total":{"$gt":100}}', null);
    expect(s?.keys).toEqual({ total: 1 });
  });
});
