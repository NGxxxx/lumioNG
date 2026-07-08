import { describe, it, expect } from "vitest";
import { describeValue, numFromExt, truncateForDisplay, MAX_DISPLAY_LEN } from "./extjson";

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
