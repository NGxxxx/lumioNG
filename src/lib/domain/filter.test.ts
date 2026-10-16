import { describe, it, expect } from "vitest";
import { parseFilter, addCondition } from "./filter";

describe("parseFilter", () => {
  it("empty → {}", () => {
    expect(parseFilter("")).toEqual({ ok: true, json: "{}" });
  });
  it("whitespace only → {}", () => {
    expect(parseFilter("   ")).toEqual({ ok: true, json: "{}" });
  });
  it("valid object → preserves trimmed string", () => {
    expect(parseFilter('  {"a":1} ')).toEqual({ ok: true, json: '{"a":1}' });
  });
  it("invalid JSON syntax → error", () => {
    const r = parseFilter("{a:1");
    expect(r.ok).toBe(false);
  });
  it("array is rejected", () => {
    const r = parseFilter("[1,2]");
    expect(r.ok).toBe(false);
  });
  it("scalar is rejected", () => {
    expect(parseFilter("5").ok).toBe(false);
    expect(parseFilter('"x"').ok).toBe(false);
  });
  it("null is rejected", () => {
    expect(parseFilter("null").ok).toBe(false);
  });
});

describe("addCondition", () => {
  const parse = (r: { ok: boolean; text?: string }) => JSON.parse((r as { text: string }).text);
  const text = (r: { ok: boolean; text?: string }) => (r as { text: string }).text;
  it("empty filter → {path: value}", () => {
    const r = addCondition("", "status", "eq", "shipped");
    expect(r.ok).toBe(true);
    expect(parse(r)).toEqual({ status: "shipped" });
    expect(parse(addCondition("{}", "a", "eq", 1))).toEqual({ a: 1 });
  });
  it("new path is spliced before the final brace, original text kept", () => {
    expect(text(addCondition('{"a":1}', "b", "eq", 2))).toBe('{"a":1, "b": 2}');
    expect(text(addCondition('{\n  "a": 1\n}', "b", "eq", 2))).toBe('{\n  "a": 1, "b": 2\n}');
  });
  it("same path wraps in $and", () => {
    const r = addCondition('{"status":"pending"}', "status", "eq", "shipped");
    expect(parse(r)).toEqual({ $and: [{ status: "pending" }, { status: "shipped" }] });
    expect(text(r)).toContain('{"status":"pending"}');
  });
  it("top-level $or wraps in $and", () => {
    expect(parse(addCondition('{"$or":[{"a":1},{"b":2}]}', "c", "eq", 3))).toEqual({
      $and: [{ $or: [{ a: 1 }, { b: 2 }] }, { c: 3 }],
    });
  });
  it("existing $and is wrapped, never rewritten", () => {
    const r = addCondition('{"$and":[{"a":1}]}', "b", "eq", 2);
    expect(parse(r)).toEqual({ $and: [{ $and: [{ a: 1 }] }, { b: 2 }] });
    expect(text(r)).toContain('{"$and":[{"a":1}]}');
  });
  it("ne / exists / notExists conditions", () => {
    expect(parse(addCondition("", "a", "ne", "x"))).toEqual({ a: { $ne: "x" } });
    expect(parse(addCondition("", "a", "exists"))).toEqual({ a: { $exists: true } });
    expect(parse(addCondition("", "a", "notExists"))).toEqual({ a: { $exists: false } });
    expect(parse(addCondition('{"b": 1}', "a", "empty"))).toEqual({ b: 1, a: { $in: [null, "", []] } });
  });
  it("ExtJSON value is preserved", () => {
    expect(parse(addCondition("", "_id", "eq", { $oid: "652f0a1b2c3d4e5f60718293" }))).toEqual({ _id: { $oid: "652f0a1b2c3d4e5f60718293" } });
  });
  it("invalid text → error, not-object → error", () => {
    expect(addCondition("{a:", "x", "eq", 1)).toEqual({ ok: false, error: "err_filter_invalid_json" });
    expect(addCondition("[1]", "x", "eq", 1)).toEqual({ ok: false, error: "err_filter_not_object" });
  });
  it("big integers and 1.0 survive byte-for-byte", () => {
    expect(text(addCondition('{"n": 9007199254740993}', "b", "eq", 1))).toContain('"n": 9007199254740993');
    expect(text(addCondition('{"a": 1.0}', "b", "eq", 1))).toContain('"a": 1.0');
    expect(text(addCondition('{"a": 1.0}', "a", "eq", 2))).toContain('{"a": 1.0}');
  });
  it("duplicate keys and key order survive", () => {
    expect(text(addCondition('{"z":1,"z":2,"a":3}', "b", "eq", 1))).toBe('{"z":1,"z":2,"a":3, "b": 1}');
  });
});

describe("parseFilter — mongosh syntax", () => {
  it("accepts unquoted keys, single quotes and operators, normalized to JSON", () => {
    expect(parseFilter("{age: {$gt: 30}, name: 'Ann'}")).toEqual({ ok: true, json: '{"age":{"$gt":30},"name":"Ann"}' });
  });

  it("turns BSON constructors into canonical Extended JSON", () => {
    expect(parseFilter('{_id: ObjectId("507f1f77bcf86cd799439011")}')).toEqual({
      ok: true,
      json: '{"_id":{"$oid":"507f1f77bcf86cd799439011"}}',
    });
    expect(parseFilter('{n: NumberLong("9007199254740993")}')).toEqual({ ok: true, json: '{"n":{"$numberLong":"9007199254740993"}}' });
  });

  it("keeps strict JSON text verbatim (big integers and key order survive)", () => {
    expect(parseFilter('{"n": 9007199254740993, "a": 1.0}')).toEqual({ ok: true, json: '{"n": 9007199254740993, "a": 1.0}' });
  });

  it("still rejects non-objects and anything outside the literal subset", () => {
    expect(parseFilter("[1, 2]")).toEqual({ ok: false, error: "err_filter_not_object" });
    expect(parseFilter("{a: someVariable}")).toEqual({ ok: false, error: "err_filter_invalid_json" });
    expect(parseFilter("{a: 1} trailing")).toEqual({ ok: false, error: "err_filter_invalid_json" });
  });

  it("addCondition works on a mongosh-syntax filter", () => {
    expect(addCondition("{age: {$gt: 30}}", "name", "eq", "Ann")).toEqual({
      ok: true,
      text: '{"age":{"$gt":30}, "name": "Ann"}',
    });
  });
});
