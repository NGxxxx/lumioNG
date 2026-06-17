import { describe, it, expect } from "vitest";
import {
  nodeType,
  hasInput,
  isContainer,
  editTextOf,
  rebuildLeaf,
  emptyValue,
  ADDABLE_TYPES,
  type LeafInputType,
} from "./bsontree";

describe("nodeType / hasInput / isContainer", () => {
  it("nhận diện kiểu khớp describeValue", () => {
    expect(nodeType("hi")).toBe("string");
    expect(nodeType(true)).toBe("bool");
    expect(nodeType({ $numberInt: "2" })).toBe("int");
    expect(nodeType({ $numberLong: "9" })).toBe("long");
    expect(nodeType({ $numberDouble: "3.14" })).toBe("double");
    expect(nodeType({ $numberDecimal: "1.5" })).toBe("decimal");
    expect(nodeType({ $oid: "507f1f77bcf86cd799439011" })).toBe("objectId");
    expect(nodeType({ $date: { $numberLong: "0" } })).toBe("date");
    expect(nodeType({ $binary: { base64: "AA==", subType: "00" } })).toBe("binary");
    expect(nodeType(null)).toBe("null");
    expect(nodeType({ x: 1 })).toBe("object");
    expect(nodeType([1, 2])).toBe("array");
  });

  it("hasInput: scalar/số/date/objectId true; binary/null/container false", () => {
    for (const t of ["string", "bool", "int", "long", "double", "decimal", "date", "objectId"] as const)
      expect(hasInput(t)).toBe(true);
    for (const t of ["binary", "null", "object", "array", "unknown"] as const)
      expect(hasInput(t)).toBe(false);
  });

  it("isContainer chỉ object/array", () => {
    expect(isContainer("object")).toBe(true);
    expect(isContainer("array")).toBe(true);
    expect(isContainer("string")).toBe(false);
    expect(isContainer("date")).toBe(false);
  });
});

describe("editTextOf", () => {
  it("trả text thô đúng cho từng kiểu lá", () => {
    expect(editTextOf("hi")).toBe("hi");
    expect(editTextOf(true)).toBe("true");
    expect(editTextOf(false)).toBe("false");
    expect(editTextOf({ $numberInt: "2" })).toBe("2");
    expect(editTextOf({ $numberLong: "9000000000" })).toBe("9000000000");
    expect(editTextOf({ $numberDouble: "3.14" })).toBe("3.14");
    expect(editTextOf({ $numberDecimal: "123.45" })).toBe("123.45");
    expect(editTextOf({ $oid: "507f1f77bcf86cd799439011" })).toBe("507f1f77bcf86cd799439011");
    expect(editTextOf({ $date: { $numberLong: "0" } })).toBe("1970-01-01T00:00:00.000Z");
    expect(editTextOf({ $date: "2024-01-15T09:30:00Z" })).toBe("2024-01-15T09:30:00Z");
    expect(editTextOf(3.14)).toBe("3.14");
  });
});

describe("rebuildLeaf round-trip giữ kiểu", () => {
  const cases: { type: LeafInputType; value: unknown }[] = [
    { type: "string", value: "hello" },
    { type: "bool", value: true },
    { type: "bool", value: false },
    { type: "int", value: { $numberInt: "2" } },
    { type: "long", value: { $numberLong: "9000000000" } },
    { type: "double", value: { $numberDouble: "3.14" } },
    { type: "decimal", value: { $numberDecimal: "123.45" } },
    { type: "objectId", value: { $oid: "507f1f77bcf86cd799439011" } },
    { type: "date", value: { $date: { $numberLong: "1705311000000" } } },
  ];
  for (const c of cases) {
    it(`round-trip ${c.type} ${JSON.stringify(c.value)}`, () => {
      const r = rebuildLeaf(c.type, editTextOf(c.value));
      expect(r).toEqual({ ok: true, value: c.value });
    });
  }
});

describe("rebuildLeaf lỗi kiểu", () => {
  it("chữ vào int → ok:false", () => {
    expect(rebuildLeaf("int", "abc").ok).toBe(false);
  });
  it("int ngoài dải 32-bit → ok:false", () => {
    expect(rebuildLeaf("int", "3000000000").ok).toBe(false);
  });
  it("bool khác true/false → ok:false", () => {
    expect(rebuildLeaf("bool", "yes").ok).toBe(false);
  });
  it("decimal sai dạng → ok:false", () => {
    expect(rebuildLeaf("decimal", "1.2.3").ok).toBe(false);
  });
  it("objectId không-24-hex → ok:false", () => {
    expect(rebuildLeaf("objectId", "xyz").ok).toBe(false);
    expect(rebuildLeaf("objectId", "507f1f77bcf86cd7994390").ok).toBe(false);
  });
  it("date sai → ok:false", () => {
    expect(rebuildLeaf("date", "không phải ngày").ok).toBe(false);
  });
  it("date không đủ YYYY-MM-DD → ok:false", () => {
    expect(rebuildLeaf("date", "2024").ok).toBe(false);
  });
});

describe("emptyValue", () => {
  it("tạo giá trị rỗng đúng kiểu", () => {
    expect(emptyValue("string")).toBe("");
    expect(emptyValue("bool")).toBe(false);
    expect(emptyValue("int")).toEqual({ $numberInt: "0" });
    expect(emptyValue("long")).toEqual({ $numberLong: "0" });
    expect(emptyValue("double")).toEqual({ $numberDouble: "0" });
    expect(emptyValue("decimal")).toEqual({ $numberDecimal: "0" });
    expect(emptyValue("date")).toEqual({ $date: { $numberLong: "0" } });
    expect(emptyValue("objectId")).toEqual({ $oid: "000000000000000000000000" });
    expect(emptyValue("null")).toBeNull();
    expect(emptyValue("object")).toEqual({});
    expect(emptyValue("array")).toEqual([]);
  });

  it("ADDABLE_TYPES đúng tập (lá + null + object + array, không binary)", () => {
    expect(ADDABLE_TYPES).toEqual([
      "string", "int", "long", "double", "decimal", "bool", "date", "objectId", "null", "object", "array",
    ]);
  });
});
