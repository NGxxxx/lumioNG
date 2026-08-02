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

  it("parses Timestamp(...) into canonical ExtJSON", () => {
    const r = parseMongoshValue("Timestamp(1690000000, 3)");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $timestamp: { t: 1690000000, i: 3 } });
  });

  it("parses Timestamp() with omitted args defaulting to 0, mirroring prelude.js", () => {
    const r = parseMongoshValue("Timestamp()");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $timestamp: { t: 0, i: 0 } });
  });

  it("parses MinKey()/MaxKey() into canonical ExtJSON", () => {
    const min = parseMongoshValue("MinKey()");
    expect(min.ok).toBe(true);
    if (min.ok) expect(min.value).toEqual({ $minKey: 1 });

    const max = parseMongoshValue("MaxKey()");
    expect(max.ok).toBe(true);
    if (max.ok) expect(max.value).toEqual({ $maxKey: 1 });
  });

  it("rejects MinKey/MaxKey called with arguments", () => {
    expect(parseMongoshValue("MinKey(1)").ok).toBe(false);
    expect(parseMongoshValue("MaxKey(1)").ok).toBe(false);
  });

  it("parses UUID(...) into the canonical $binary subtype 04 shape", () => {
    const r = parseMongoshValue('UUID("d1b7e4b2-8c1a-4e2a-9f3d-1a2b3c4d5e6f")');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $binary: { base64: Buffer.from("d1b7e4b28c1a4e2a9f3d1a2b3c4d5e6f", "hex").toString("base64"), subType: "04" } });
  });

  it("accepts a UUID without dashes and rejects a malformed one", () => {
    const r = parseMongoshValue('UUID("d1b7e4b28c1a4e2a9f3d1a2b3c4d5e6f")');
    expect(r.ok).toBe(true);
    expect(parseMongoshValue('UUID("not-a-uuid")').ok).toBe(false);
  });

  it("parses BinData(subtype, base64) into canonical ExtJSON, hex-padding the subtype", () => {
    const r = parseMongoshValue('BinData(0, "AQIDBA==")');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $binary: { base64: "AQIDBA==", subType: "00" } });

    const r2 = parseMongoshValue('BinData(128, "AQIDBA==")');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect((r2.value as { $binary: { subType: string } }).$binary.subType).toBe("80");
  });

  it("parses a bare /pattern/flags regex literal into the canonical $regularExpression shape", () => {
    const r = parseMongoshValue("/^abc$/i");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $regularExpression: { pattern: "^abc$", options: "i" } });
  });

  it("parses a regex literal with no flags and an escaped slash in the pattern", () => {
    const r = parseMongoshValue("/a\\/b/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $regularExpression: { pattern: "a\\/b", options: "" } });
  });

  it("doesn't let an unescaped slash inside a character class end a regex literal early", () => {
    const r = parseMongoshValue("/[/]/g");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ $regularExpression: { pattern: "[/]", options: "g" } });
  });

  it("parses a regex literal as a nested field value inside an object", () => {
    const r = parseMongoshValue('{ name: /^a/i }');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: { $regularExpression: { pattern: "^a", options: "i" } } });
  });

  it("fails on an unterminated regex literal (raw newline before the closing slash)", () => {
    expect(parseMongoshValue("/abc\ndef/").ok).toBe(false);
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
