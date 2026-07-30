import { describe, it, expect } from "vitest";
import { parseMongoshValue } from "./mongoshLiteral";

describe("parseMongoshValue", () => {
  it("parses a plain object with quoted keys", () => {
    const r = parseMongoshValue('{ "status": "shipped" }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ status: "shipped" });
  });

  it("parses unquoted keys, single-quoted strings, nested objects and arrays", () => {
    const r = parseMongoshValue("{ _id: '$region', total: { $sum: '$amount' }, tags: ['a', 'b'] }");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ _id: "$region", total: { $sum: "$amount" }, tags: ["a", "b"] });
  });

  it("parses numbers, booleans, and null", () => {
    const r = parseMongoshValue("{ n: -1.5e2, ok: true, bad: false, missing: null }");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ n: -150, ok: true, bad: false, missing: null });
  });

  it("parses ObjectId(...) into canonical ExtJSON", () => {
    const r = parseMongoshValue('ObjectId("507f191e810c19729de860ea")');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $oid: "507f191e810c19729de860ea" });
  });

  it("rejects a malformed ObjectId argument", () => {
    expect(parseMongoshValue('ObjectId("not-hex")').ok).toBe(false);
  });

  it("parses ISODate(...) into canonical ExtJSON", () => {
    const r = parseMongoshValue('ISODate("2024-01-01T00:00:00.000Z")');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $date: { $numberLong: String(Date.parse("2024-01-01T00:00:00.000Z")) } });
  });

  it("parses NumberLong/NumberDecimal/NumberInt into canonical ExtJSON", () => {
    const long = parseMongoshValue('NumberLong("123")');
    expect(long.ok).toBe(true);
    if (long.ok) expect(long.value).toEqual({ $numberLong: "123" });

    const decimal = parseMongoshValue('NumberDecimal("1.50")');
    expect(decimal.ok).toBe(true);
    if (decimal.ok) expect(decimal.value).toEqual({ $numberDecimal: "1.50" });

    const int = parseMongoshValue("NumberInt(5)");
    expect(int.ok).toBe(true);
    if (int.ok) expect(int.value).toEqual({ $numberInt: "5" });
  });

  it("fails on a bare identifier (a real variable reference)", () => {
    expect(parseMongoshValue("cutoff").ok).toBe(false);
  });

  it("fails on an unwhitelisted function call", () => {
    expect(parseMongoshValue('someFunction("x")').ok).toBe(false);
  });

  it("reports `end` as the index right after the parsed value, ignoring trailing content", () => {
    const text = "[1, 2] , more";
    const r = parseMongoshValue(text);
    expect(r.ok).toBe(true);
    expect(text.slice((r as { end: number }).end)).toBe(" , more");
  });
});
