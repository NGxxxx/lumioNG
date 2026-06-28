import { describe, it, expect } from "vitest";
import {
  parseQueryStatement,
  methodHeadAt,
  aggregateTemplate,
  pipelineHasTrailingLimit,
  isWriteKind,
  isDestructiveKind,
  writeFilterIsEmpty,
  writeTargetSummary,
  type ParsedQuery,
} from "./queryStatement";

describe("aggregateTemplate", () => {
  it("seeds a getCollection().aggregate template", () => {
    expect(aggregateTemplate("movies")).toBe('db.getCollection("movies").aggregate([\n  { "$match": {} }\n])');
  });
  it("handles an empty collection name", () => {
    expect(aggregateTemplate("")).toContain('db.getCollection("").aggregate(');
  });
});

describe("pipelineHasTrailingLimit", () => {
  it("is true when the last stage is $limit", () => {
    expect(pipelineHasTrailingLimit('[{ "$match": {} }, { "$limit": 10 }]')).toBe(true);
  });
  it("is false otherwise", () => {
    expect(pipelineHasTrailingLimit('[{ "$match": {} }]')).toBe(false);
  });
  it("is false on unparseable text", () => {
    expect(pipelineHasTrailingLimit("[{ not json")).toBe(false);
  });
});

describe("parseQueryStatement — aggregate", () => {
  it("parses getCollection().aggregate(pipeline)", () => {
    const r = parseQueryStatement('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    expect(r).toEqual({ kind: "aggregate", coll: "orders", pipeline: '[{ "$match": { "a": 1 } }]' });
  });
  it("parses db.coll.aggregate and tolerates a trailing semicolon", () => {
    const r = parseQueryStatement('db.orders.aggregate([{ "$count": "n" }]);');
    expect(r.kind).toBe("aggregate");
    expect(r.coll).toBe("orders");
    if (r.kind === "aggregate") expect(r.pipeline).toBe('[{ "$count": "n" }]');
  });
  it("throws on an empty collection name", () => {
    expect(() => parseQueryStatement('db.getCollection("").aggregate([])')).toThrow();
  });
  it("throws on a malformed head", () => {
    expect(() => parseQueryStatement("select * from orders")).toThrow();
  });
});

describe("parseQueryStatement — find", () => {
  it("parses find() with no args → empty filter", () => {
    expect(parseQueryStatement("db.c.find()")).toEqual({
      kind: "find", coll: "c", filter: "{}", projection: null, sort: null, skip: null, limit: null,
    });
  });
  it("parses a filter only", () => {
    const r = parseQueryStatement('db.c.find({ "a": 1 })');
    expect(r.kind).toBe("find");
    if (r.kind === "find") { expect(r.filter).toBe('{ "a": 1 }'); expect(r.projection).toBeNull(); }
  });
  it("parses filter + projection", () => {
    const r = parseQueryStatement('db.c.find({ "a": 1 }, { "a": 1, "_id": 0 })');
    expect(r.kind).toBe("find");
    if (r.kind === "find") { expect(r.filter).toBe('{ "a": 1 }'); expect(r.projection).toBe('{ "a": 1, "_id": 0 }'); }
  });
  it("parses a chain in any order/subset", () => {
    const r = parseQueryStatement('db.c.find({}).limit(5).sort({ "a": -1 }).skip(2)');
    expect(r.kind).toBe("find");
    if (r.kind === "find") {
      expect(r.sort).toBe('{ "a": -1 }'); expect(r.skip).toBe(2); expect(r.limit).toBe(5);
    }
  });
  it("respects nested braces inside sort", () => {
    const r = parseQueryStatement('db.c.find({}).sort({ "a": { "$meta": "x" } })');
    expect(r.kind).toBe("find");
    if (r.kind === "find") expect(r.sort).toBe('{ "a": { "$meta": "x" } }');
  });
  it("ignores braces inside string literals in the filter", () => {
    const r = parseQueryStatement('db.c.find({ "label": "a{b}c", "a": 1 }).limit(3)');
    expect(r.kind).toBe("find");
    if (r.kind === "find") { expect(r.filter).toBe('{ "label": "a{b}c", "a": 1 }'); expect(r.limit).toBe(3); }
  });
  it("tolerates a trailing .toArray() and semicolon", () => {
    const r = parseQueryStatement("db.c.find({}).sort({ \"a\": 1 }).toArray();");
    expect(r.kind).toBe("find");
    if (r.kind === "find") expect(r.sort).toBe('{ "a": 1 }');
  });
  it("last .sort wins", () => {
    const r = parseQueryStatement('db.c.find({}).sort({ "a": 1 }).sort({ "b": -1 })');
    expect(r.kind).toBe("find");
    if (r.kind === "find") expect(r.sort).toBe('{ "b": -1 }');
  });
  it("throws on >2 args", () => {
    expect(() => parseQueryStatement("db.c.find({}, {}, {})")).toThrow(/at most/);
  });
  it("throws on a non-integer skip/limit", () => {
    expect(() => parseQueryStatement("db.c.find({}).limit(1.5)")).toThrow(/integer/);
    expect(() => parseQueryStatement("db.c.find({}).skip(x)")).toThrow(/integer/);
  });
  it("throws on an unsupported chained method", () => {
    expect(() => parseQueryStatement("db.c.find({}).hint({})")).toThrow(/Unsupported method/);
  });
  it("throws on unbalanced parentheses", () => {
    expect(() => parseQueryStatement("db.c.find({ ")).toThrow();
  });
});

describe("parseQueryStatement — count", () => {
  it("parses countDocuments(filter)", () => {
    expect(parseQueryStatement('db.c.countDocuments({ "a": 1 })')).toEqual({
      kind: "count", coll: "c", filter: '{ "a": 1 }',
    });
  });
  it("parses count() with no args → empty filter", () => {
    expect(parseQueryStatement("db.c.count()")).toEqual({ kind: "count", coll: "c", filter: "{}" });
  });
  it("throws when count has a trailing call", () => {
    expect(() => parseQueryStatement("db.c.count().toArray()")).toThrow();
  });
});

describe("methodHeadAt", () => {
  it("returns method, coll, and the index of its opening paren", () => {
    const text = 'db.c.find({ "a": 1 })';
    const h = methodHeadAt(text, text.length);
    expect(h).not.toBeNull();
    expect(h!.method).toBe("find");
    expect(h!.coll).toBe("c");
    expect(text[h!.argOpen]).toBe("(");
  });
  it("resolves the collection through getCollection(\"…\")", () => {
    const t = 'db.getCollection("movies").aggregate([{ "$ma';
    const h = methodHeadAt(t, t.length);
    expect(h!.method).toBe("aggregate");
    expect(h!.coll).toBe("movies");
  });
  it("selects the statement governing the cursor in a multi-statement document", () => {
    const text = 'db.a.find({})\ndb.b.aggregate([{ "$ma" }])';
    const pos = text.indexOf("$ma");
    const h = methodHeadAt(text, pos);
    expect(h!.method).toBe("aggregate");
    expect(h!.coll).toBe("b");
  });
  it("returns null before any method call and for non-statements", () => {
    expect(methodHeadAt("db.c.", 5)).toBeNull();
    expect(methodHeadAt("not a statement", 5)).toBeNull();
  });
});

describe("parseQueryStatement — distinct", () => {
  it("parses distinct(field) with no filter → empty filter", () => {
    expect(parseQueryStatement('db.c.distinct("status")')).toEqual({
      kind: "distinct", coll: "c", field: "status", filter: "{}",
    });
  });
  it("parses distinct(field, filter)", () => {
    expect(parseQueryStatement('db.c.distinct("status", { "a": 1 })')).toEqual({
      kind: "distinct", coll: "c", field: "status", filter: '{ "a": 1 }',
    });
  });
  it("accepts a single-quoted field", () => {
    const r = parseQueryStatement("db.c.distinct('status')");
    if (r.kind === "distinct") expect(r.field).toBe("status");
  });
  it("keeps a dotted field name", () => {
    const r = parseQueryStatement('db.c.distinct("addr.city")');
    if (r.kind === "distinct") expect(r.field).toBe("addr.city");
  });
  it("keeps a comma inside the field string", () => {
    const r = parseQueryStatement('db.c.distinct("a,b")');
    if (r.kind === "distinct") { expect(r.field).toBe("a,b"); expect(r.filter).toBe("{}"); }
  });
  it("parses the getCollection() form", () => {
    const r = parseQueryStatement('db.getCollection("orders").distinct("customerId")');
    expect(r.kind).toBe("distinct");
    if (r.kind === "distinct") { expect(r.coll).toBe("orders"); expect(r.field).toBe("customerId"); }
  });
  it("throws when the field is missing", () => {
    expect(() => parseQueryStatement("db.c.distinct()")).toThrow(/string literal/);
  });
  it("throws when the field is a bare identifier", () => {
    expect(() => parseQueryStatement("db.c.distinct(status)")).toThrow(/string literal/);
  });
  it("throws on a trailing call", () => {
    expect(() => parseQueryStatement('db.c.distinct("a").toArray()')).toThrow(/trailing/);
  });
  it("throws on more than two args", () => {
    expect(() => parseQueryStatement('db.c.distinct("a", {}, {})')).toThrow(/field and an optional filter/);
  });
});

describe("parseQueryStatement — writes", () => {
  it("parses insertOne(doc)", () => {
    expect(parseQueryStatement('db.c.insertOne({ "a": 1 })')).toEqual({
      kind: "insertOne", coll: "c", doc: '{ "a": 1 }',
    });
  });
  it("parses insertMany([...])", () => {
    expect(parseQueryStatement('db.c.insertMany([{ "a": 1 }, { "b": 2 }])')).toEqual({
      kind: "insertMany", coll: "c", docs: '[{ "a": 1 }, { "b": 2 }]',
    });
  });
  it("parses updateOne(filter, update)", () => {
    expect(parseQueryStatement('db.c.updateOne({ "a": 1 }, { "$set": { "b": 2 } })')).toEqual({
      kind: "updateOne", coll: "c", filter: '{ "a": 1 }', update: '{ "$set": { "b": 2 } }',
    });
  });
  it("parses updateMany(filter, update)", () => {
    const r = parseQueryStatement('db.c.updateMany({}, { "$set": { "x": 1 } })');
    expect(r.kind).toBe("updateMany");
    if (r.kind === "updateMany") { expect(r.filter).toBe("{}"); expect(r.update).toBe('{ "$set": { "x": 1 } }'); }
  });
  it("parses replaceOne(filter, replacement)", () => {
    expect(parseQueryStatement('db.c.replaceOne({ "a": 1 }, { "a": 2 })')).toEqual({
      kind: "replaceOne", coll: "c", filter: '{ "a": 1 }', replacement: '{ "a": 2 }',
    });
  });
  it("parses deleteOne(filter) and deleteMany(filter)", () => {
    expect(parseQueryStatement('db.c.deleteOne({ "a": 1 })')).toEqual({ kind: "deleteOne", coll: "c", filter: '{ "a": 1 }' });
    expect(parseQueryStatement("db.c.deleteMany({})")).toEqual({ kind: "deleteMany", coll: "c", filter: "{}" });
  });
  it("parses the getCollection() form for writes", () => {
    const r = parseQueryStatement('db.getCollection("orders").deleteMany({ "s": "x" })');
    expect(r.kind).toBe("deleteMany");
    if (r.kind === "deleteMany") expect(r.coll).toBe("orders");
  });
  it("tolerates a trailing semicolon", () => {
    expect(parseQueryStatement('db.c.insertOne({ "a": 1 });').kind).toBe("insertOne");
  });
  it("throws when insertOne has no document", () => {
    expect(() => parseQueryStatement("db.c.insertOne()")).toThrow(/requires a document/);
  });
  it("throws when insertMany has no array", () => {
    expect(() => parseQueryStatement("db.c.insertMany()")).toThrow(/array of documents/);
  });
  it("throws when updateOne is missing the update", () => {
    expect(() => parseQueryStatement('db.c.updateOne({ "a": 1 })')).toThrow(/filter and an update/);
  });
  it("throws when deleteOne has no filter", () => {
    expect(() => parseQueryStatement("db.c.deleteOne()")).toThrow(/requires a filter/);
  });
  it("rejects a surplus options arg on updateOne", () => {
    expect(() => parseQueryStatement("db.c.updateOne({}, {}, { upsert: true })")).toThrow(/options are not supported/);
  });
  it("rejects a trailing call after a write", () => {
    expect(() => parseQueryStatement('db.c.deleteMany({}).toArray()')).toThrow(/trailing/);
  });
});

describe("write classifiers", () => {
  it("isWriteKind is true for writes, false for reads", () => {
    expect(isWriteKind("insertOne")).toBe(true);
    expect(isWriteKind("deleteMany")).toBe(true);
    expect(isWriteKind("find")).toBe(false);
    expect(isWriteKind("distinct")).toBe(false);
  });
  it("isDestructiveKind is true for update/replace/delete only", () => {
    expect(isDestructiveKind("deleteOne")).toBe(true);
    expect(isDestructiveKind("updateMany")).toBe(true);
    expect(isDestructiveKind("replaceOne")).toBe(true);
    expect(isDestructiveKind("insertOne")).toBe(false);
    expect(isDestructiveKind("find")).toBe(false);
  });
  it("writeFilterIsEmpty true only for an empty-filter destructive op", () => {
    expect(writeFilterIsEmpty({ kind: "deleteMany", coll: "c", filter: "{}" })).toBe(true);
    expect(writeFilterIsEmpty({ kind: "deleteMany", coll: "c", filter: "{ }" })).toBe(true);
    expect(writeFilterIsEmpty({ kind: "updateOne", coll: "c", filter: "{}", update: "{}" })).toBe(true);
    expect(writeFilterIsEmpty({ kind: "deleteOne", coll: "c", filter: '{ "a": 1 }' })).toBe(false);
    expect(writeFilterIsEmpty({ kind: "insertOne", coll: "c", doc: "{}" })).toBe(false);
  });
  it("writeTargetSummary returns the relevant argument", () => {
    expect(writeTargetSummary({ kind: "insertOne", coll: "c", doc: '{ "a": 1 }' })).toBe('{ "a": 1 }');
    expect(writeTargetSummary({ kind: "deleteMany", coll: "c", filter: '{ "a": 1 }' })).toBe('{ "a": 1 }');
    expect(writeTargetSummary({ kind: "updateOne", coll: "c", filter: '{ "a": 1 }', update: "{}" })).toBe('{ "a": 1 }');
  });
});
