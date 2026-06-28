import { describe, it, expect } from "vitest";
import { isInlineEditable, editTextOf, rebuildValue, buildSetUpdate } from "./celledit";

describe("isInlineEditable", () => {
  it("false for _id column even when value is a string", () => {
    expect(isInlineEditable("_id", "abc")).toBe(false);
  });
  it("true for scalars and numeric wrappers", () => {
    expect(isInlineEditable("a", "hello")).toBe(true);
    expect(isInlineEditable("a", true)).toBe(true);
    expect(isInlineEditable("a", 3.14)).toBe(true);
    expect(isInlineEditable("a", { $numberInt: "2" })).toBe(true);
    expect(isInlineEditable("a", { $numberLong: "9000000000" })).toBe(true);
    expect(isInlineEditable("a", { $numberDouble: "3.14" })).toBe(true);
    expect(isInlineEditable("a", { $numberDecimal: "123.45" })).toBe(true);
  });
  it("false for objectId/date/binary/object/array/null", () => {
    expect(isInlineEditable("a", { $oid: "507f1f77bcf86cd799439011" })).toBe(false);
    expect(isInlineEditable("a", { $date: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isInlineEditable("a", { $binary: { base64: "AA==", subType: "00" } })).toBe(false);
    expect(isInlineEditable("a", { x: 1 })).toBe(false);
    expect(isInlineEditable("a", [1, 2])).toBe(false);
    expect(isInlineEditable("a", null)).toBe(false);
  });
});

describe("editTextOf", () => {
  it("returns correct raw text for each type", () => {
    expect(editTextOf("hi")).toBe("hi");
    expect(editTextOf(true)).toBe("true");
    expect(editTextOf(3.14)).toBe("3.14");
    expect(editTextOf({ $numberInt: "2" })).toBe("2");
    expect(editTextOf({ $numberLong: "9000000000" })).toBe("9000000000");
    expect(editTextOf({ $numberDouble: "3.14" })).toBe("3.14");
    expect(editTextOf({ $numberDecimal: "123.45" })).toBe("123.45");
  });
});

describe("rebuildValue round-trip preserves type", () => {
  const cases: unknown[] = [
    "hello",
    true,
    false,
    { $numberInt: "2" },
    { $numberLong: "9000000000" },
    { $numberDouble: "3.14" },
    { $numberDecimal: "123.45" },
  ];
  for (const original of cases) {
    it(`round-trip ${JSON.stringify(original)}`, () => {
      const r = rebuildValue(original, editTextOf(original));
      expect(r).toEqual({ ok: true, value: original });
    });
  }
  it("edits a $numberInt to a new valid value", () => {
    expect(rebuildValue({ $numberInt: "2" }, "5")).toEqual({ ok: true, value: { $numberInt: "5" } });
  });
  it("replaces a string value", () => {
    expect(rebuildValue("a", "b")).toEqual({ ok: true, value: "b" });
  });
});

describe("rebuildValue type errors", () => {
  it("non-numeric input for $numberInt → ok:false", () => {
    const r = rebuildValue({ $numberInt: "2" }, "abc");
    expect(r.ok).toBe(false);
  });
  it("$numberInt out of 32-bit range → ok:false", () => {
    const r = rebuildValue({ $numberInt: "2" }, "3000000000");
    expect(r.ok).toBe(false);
  });
  it("bool other than true/false → ok:false", () => {
    const r = rebuildValue(true, "yes");
    expect(r.ok).toBe(false);
  });
  it("$numberDecimal bad format → ok:false", () => {
    const r = rebuildValue({ $numberDecimal: "1.0" }, "1.2.3");
    expect(r.ok).toBe(false);
  });
  it("$numberInt accepts the minimum valid value -2147483648", () => {
    expect(rebuildValue({ $numberInt: "0" }, "-2147483648")).toEqual({ ok: true, value: { $numberInt: "-2147483648" } });
  });
  it("$numberLong out of 64-bit range → ok:false", () => {
    const r = rebuildValue({ $numberLong: "1" }, "99999999999999999999999");
    expect(r.ok).toBe(false);
  });
});

describe("buildSetUpdate", () => {
  it("wraps a scalar field in $set", () => {
    expect(buildSetUpdate("name", "Z")).toBe('{"$set":{"name":"Z"}}');
    expect(buildSetUpdate("ok", true)).toBe('{"$set":{"ok":true}}');
    expect(buildSetUpdate("n", 3.14)).toBe('{"$set":{"n":3.14}}');
  });
  it("serializes an ExtJSON numeric wrapper", () => {
    expect(buildSetUpdate("n", { $numberLong: "9000000000" })).toBe(
      '{"$set":{"n":{"$numberLong":"9000000000"}}}',
    );
  });
});
