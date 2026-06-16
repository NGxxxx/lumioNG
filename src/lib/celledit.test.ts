import { describe, it, expect } from "vitest";
import { isInlineEditable, editTextOf, rebuildValue } from "./celledit";

describe("isInlineEditable", () => {
  it("false cho cột _id dù giá trị là string", () => {
    expect(isInlineEditable("_id", "abc")).toBe(false);
  });
  it("true cho scalar và numeric wrapper", () => {
    expect(isInlineEditable("a", "hello")).toBe(true);
    expect(isInlineEditable("a", true)).toBe(true);
    expect(isInlineEditable("a", 3.14)).toBe(true);
    expect(isInlineEditable("a", { $numberInt: "2" })).toBe(true);
    expect(isInlineEditable("a", { $numberLong: "9000000000" })).toBe(true);
    expect(isInlineEditable("a", { $numberDouble: "3.14" })).toBe(true);
    expect(isInlineEditable("a", { $numberDecimal: "123.45" })).toBe(true);
  });
  it("false cho objectId/date/binary/object/array/null", () => {
    expect(isInlineEditable("a", { $oid: "507f1f77bcf86cd799439011" })).toBe(false);
    expect(isInlineEditable("a", { $date: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isInlineEditable("a", { $binary: { base64: "AA==", subType: "00" } })).toBe(false);
    expect(isInlineEditable("a", { x: 1 })).toBe(false);
    expect(isInlineEditable("a", [1, 2])).toBe(false);
    expect(isInlineEditable("a", null)).toBe(false);
  });
});

describe("editTextOf", () => {
  it("trả text thô đúng cho từng kiểu", () => {
    expect(editTextOf("hi")).toBe("hi");
    expect(editTextOf(true)).toBe("true");
    expect(editTextOf(3.14)).toBe("3.14");
    expect(editTextOf({ $numberInt: "2" })).toBe("2");
    expect(editTextOf({ $numberLong: "9000000000" })).toBe("9000000000");
    expect(editTextOf({ $numberDouble: "3.14" })).toBe("3.14");
    expect(editTextOf({ $numberDecimal: "123.45" })).toBe("123.45");
  });
});

describe("rebuildValue round-trip giữ kiểu", () => {
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
  it("sửa giá trị $numberInt hợp lệ", () => {
    expect(rebuildValue({ $numberInt: "2" }, "5")).toEqual({ ok: true, value: { $numberInt: "5" } });
  });
  it("sửa string thành chuỗi mới", () => {
    expect(rebuildValue("a", "b")).toEqual({ ok: true, value: "b" });
  });
});

describe("rebuildValue lỗi kiểu", () => {
  it("chữ vào $numberInt → ok:false", () => {
    const r = rebuildValue({ $numberInt: "2" }, "abc");
    expect(r.ok).toBe(false);
  });
  it("$numberInt ngoài dải 32-bit → ok:false", () => {
    const r = rebuildValue({ $numberInt: "2" }, "3000000000");
    expect(r.ok).toBe(false);
  });
  it("bool khác true/false → ok:false", () => {
    const r = rebuildValue(true, "yes");
    expect(r.ok).toBe(false);
  });
  it("$numberDecimal sai dạng → ok:false", () => {
    const r = rebuildValue({ $numberDecimal: "1.0" }, "1.2.3");
    expect(r.ok).toBe(false);
  });
  it("$numberInt nhận giá trị min hợp lệ -2147483648", () => {
    expect(rebuildValue({ $numberInt: "0" }, "-2147483648")).toEqual({ ok: true, value: { $numberInt: "-2147483648" } });
  });
  it("$numberLong vượt dải 64-bit → ok:false", () => {
    const r = rebuildValue({ $numberLong: "1" }, "99999999999999999999999");
    expect(r.ok).toBe(false);
  });
});
