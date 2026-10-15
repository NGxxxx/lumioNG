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
