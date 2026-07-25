import { describe, it, expect } from "vitest";
import { describeValue, numFromExt, truncateForDisplay, MAX_DISPLAY_LEN, clipboardTextOf, nestedJsonPretty, containerKind } from "./extjson";

describe("truncateForDisplay", () => {
  it("leaves short text unchanged", () => {
    expect(truncateForDisplay("hello")).toBe("hello");
  });
  it("truncates text over the threshold and appends an ellipsis", () => {
    const big = "x".repeat(MAX_DISPLAY_LEN + 1000);
    const out = truncateForDisplay(big);
    expect(out.length).toBe(MAX_DISPLAY_LEN + 1);
    expect(out.endsWith("…")).toBe(true);
  });
  it("does not truncate a 16MB string only up to the exact threshold boundary", () => {
    const huge = "x".repeat(16 * 1024 * 1024);
    const out = truncateForDisplay(huge);
    expect(out.length).toBe(MAX_DISPLAY_LEN + 1);
  });
});

describe("numFromExt", () => {
  it("raw number", () => expect(numFromExt(42)).toBe(42));
  it("$numberInt", () => expect(numFromExt({ $numberInt: "7" })).toBe(7));
  it("$numberLong", () => expect(numFromExt({ $numberLong: "1500" })).toBe(1500));
  it("$numberDouble", () => expect(numFromExt({ $numberDouble: "1.5" })).toBe(1.5));
  it("$numberDecimal", () => expect(numFromExt({ $numberDecimal: "9.99" })).toBe(9.99));
  it("non-numeric value → null", () => {
    expect(numFromExt(undefined)).toBeNull();
    expect(numFromExt("abc")).toBeNull();
    expect(numFromExt({ foo: 1 })).toBeNull();
  });
  it("ExtJSON parse ra NaN → null (guard)", () => {
    expect(numFromExt({ $numberInt: "abc" })).toBeNull();
    expect(numFromExt({ $numberDouble: "x" })).toBeNull();
  });
});

describe("describeValue", () => {
  it("identifies ObjectId", () => {
    const r = describeValue({ $oid: "507f1f77bcf86cd799439011" });
    expect(r.type).toBe("objectId");
    expect(r.display).toBe("507f1f77bcf86cd799439011");
  });
  it("identifies Date as ISO string", () => {
    const r = describeValue({ $date: "2023-11-14T22:13:20Z" });
    expect(r.type).toBe("date");
    expect(r.display).toContain("2023");
  });
  it("identifies Date as $numberLong (canonical form)", () => {
    const r = describeValue({ $date: { $numberLong: "1700000000000" } });
    expect(r.type).toBe("date");
  });
  it("identifies numberInt", () => {
    const r = describeValue({ $numberInt: "42" });
    expect(r.type).toBe("int");
    expect(r.display).toBe("42");
  });
  it("identifies numberLong", () => {
    const r = describeValue({ $numberLong: "9000000000" });
    expect(r.type).toBe("long");
    expect(r.display).toBe("9000000000");
  });
  it("identifies numberDouble", () => {
    const r = describeValue({ $numberDouble: "3.14" });
    expect(r.type).toBe("double");
    expect(r.display).toBe("3.14");
  });
  it("identifies numberDecimal", () => {
    const r = describeValue({ $numberDecimal: "123.45" });
    expect(r.type).toBe("decimal");
    expect(r.display).toBe("123.45");
  });
  it("identifies binary", () => {
    const r = describeValue({ $binary: { base64: "AQIDBA==", subType: "00" } });
    expect(r.type).toBe("binary");
  });
  it("identifies regex", () => {
    const r = describeValue({ $regularExpression: { pattern: "^a.*z$", options: "im" } });
    expect(r.type).toBe("regex");
    expect(r.display).toBe("/^a.*z$/im");
  });
  it("identifies timestamp", () => {
    const r = describeValue({ $timestamp: { t: 1700000000, i: 5 } });
    expect(r.type).toBe("timestamp");
    expect(r.display).toBe("Timestamp(1700000000, 5)");
  });
  it("identifies minKey and maxKey", () => {
    expect(describeValue({ $minKey: 1 })).toEqual({ type: "minKey", display: "MinKey()" });
    expect(describeValue({ $maxKey: 1 })).toEqual({ type: "maxKey", display: "MaxKey()" });
  });
  it("identifies JavaScript code, with and without scope", () => {
    expect(describeValue({ $code: "function() {}" })).toEqual({ type: "code", display: "function() {}" });
    const withScope = describeValue({ $code: "function() {}", $scope: { x: 1 } });
    expect(withScope.type).toBe("code");
    expect(withScope.display).toContain("function() {}");
    expect(withScope.display).toContain('"x"');
  });
  it("identifies symbol", () => {
    const r = describeValue({ $symbol: "mySymbol" });
    expect(r.type).toBe("symbol");
    expect(r.display).toBe("mySymbol");
  });
  it("identifies dbPointer", () => {
    const r = describeValue({ $dbPointer: { $ref: "coll", $id: { $oid: "507f1f77bcf86cd799439011" } } });
    expect(r.type).toBe("dbPointer");
    expect(r.display).toBe("DBPointer(coll, 507f1f77bcf86cd799439011)");
  });
  it("identifies undefined", () => {
    const r = describeValue({ $undefined: true });
    expect(r.type).toBe("undefined");
    expect(r.display).toBe("undefined");
  });
  it("plain string", () => {
    const r = describeValue("hello");
    expect(r.type).toBe("string");
    expect(r.display).toBe("hello");
  });
  it("boolean and null", () => {
    expect(describeValue(true).type).toBe("bool");
    expect(describeValue(null).type).toBe("null");
  });
  it("nested object → truncated preview", () => {
    const r = describeValue({ name: "a", age: { $numberInt: "30" } });
    expect(r.type).toBe("object");
    expect(r.display.startsWith("{")).toBe(true);
  });
  it("array → truncated preview", () => {
    const r = describeValue([1, 2, 3]);
    expect(r.type).toBe("array");
    expect(r.display.startsWith("[")).toBe(true);
  });
});

describe("containerKind", () => {
  it("treats every ExtJSON wrapper as a leaf, not a container", () => {
    expect(containerKind({ $oid: "507f1f77bcf86cd799439011" })).toBeNull();
    expect(containerKind({ $binary: { base64: "AQ==", subType: "00" } })).toBeNull();
    expect(containerKind({ $regularExpression: { pattern: "a", options: "" } })).toBeNull();
    expect(containerKind({ $timestamp: { t: 1, i: 1 } })).toBeNull();
    expect(containerKind({ $minKey: 1 })).toBeNull();
    expect(containerKind({ $maxKey: 1 })).toBeNull();
    expect(containerKind({ $code: "function() {}" })).toBeNull();
    expect(containerKind({ $symbol: "s" })).toBeNull();
    expect(containerKind({ $dbPointer: { $ref: "c", $id: { $oid: "507f1f77bcf86cd799439011" } } })).toBeNull();
    expect(containerKind({ $undefined: true })).toBeNull();
  });
  it("still recognizes plain objects and arrays as containers", () => {
    expect(containerKind({ a: 1 })).toBe("object");
    expect(containerKind([1, 2])).toBe("array");
    expect(containerKind("hello")).toBeNull();
  });
});

describe("nestedJsonPretty", () => {
  it("pretty-prints a string field holding a JSON array", () => {
    const s = JSON.stringify([{ id: "8185", name: "Samac maintain" }]);
    expect(nestedJsonPretty(s)).toBe(JSON.stringify(JSON.parse(s), null, 2));
  });
  it("pretty-prints a string field holding a JSON object", () => {
    const s = '{"a":1,"b":[1,2]}';
    expect(nestedJsonPretty(s)).toBe(JSON.stringify(JSON.parse(s), null, 2));
  });
  it("returns null for plain (non-JSON) strings", () => {
    expect(nestedJsonPretty("hello world")).toBeNull();
  });
  it("returns null for JSON primitives (not object/array)", () => {
    expect(nestedJsonPretty("123")).toBeNull();
    expect(nestedJsonPretty("true")).toBeNull();
    expect(nestedJsonPretty('"quoted"')).toBeNull();
  });
  it("returns null for malformed JSON-looking text", () => {
    expect(nestedJsonPretty("[1, 2,")).toBeNull();
  });
});

describe("clipboardTextOf", () => {
  it("serializes containers fully (not the 80-char preview)", () => {
    const big = { a: "x".repeat(200), b: [1, 2, 3] };
    const text = clipboardTextOf(big);
    expect(text).toBe(JSON.stringify(big, null, 2));
    expect(text).toContain("x".repeat(200)); // preview would have truncated this
  });
  it("uses display text for leaves", () => {
    expect(clipboardTextOf({ $oid: "aabbcc" })).toBe("aabbcc");
    expect(clipboardTextOf("hi")).toBe("hi");
    expect(clipboardTextOf(null)).toBe("null");
  });
});
