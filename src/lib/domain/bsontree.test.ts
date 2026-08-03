import { describe, it, expect } from "vitest";
import {
  hasInput,
  editTextOf,
  rebuildLeaf,
  emptyValue,
  validateNewFieldName,
  ADDABLE_TYPES,
  type LeafInputType,
} from "./bsontree";

describe("hasInput", () => {
  it("hasInput: scalar/number/date/objectId true; binary/null/container false", () => {
    for (const t of ["string", "bool", "int", "long", "double", "decimal", "date", "objectId"] as const)
      expect(hasInput(t)).toBe(true);
    for (const t of ["binary", "null", "object", "array", "unknown"] as const)
      expect(hasInput(t)).toBe(false);
  });
});

describe("editTextOf", () => {
  it("returns correct raw text for each leaf type", () => {
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

describe("rebuildLeaf round-trip preserves type", () => {
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

describe("rebuildLeaf type errors", () => {
  it("non-numeric input for int → ok:false", () => {
    expect(rebuildLeaf("int", "abc").ok).toBe(false);
  });
  it("int out of 32-bit range → ok:false", () => {
    expect(rebuildLeaf("int", "3000000000").ok).toBe(false);
  });
  it("bool other than true/false → ok:false", () => {
    expect(rebuildLeaf("bool", "yes").ok).toBe(false);
  });
  it("decimal bad format → ok:false", () => {
    expect(rebuildLeaf("decimal", "1.2.3").ok).toBe(false);
  });
  it("objectId not 24 hex chars → ok:false", () => {
    expect(rebuildLeaf("objectId", "xyz").ok).toBe(false);
    expect(rebuildLeaf("objectId", "507f1f77bcf86cd7994390").ok).toBe(false);
  });
  it("invalid date string → ok:false", () => {
    expect(rebuildLeaf("date", "not a date").ok).toBe(false);
  });
  it("date without YYYY-MM-DD prefix → ok:false", () => {
    expect(rebuildLeaf("date", "2024").ok).toBe(false);
  });
});

describe("rebuildLeaf preferBare (double only)", () => {
  it("keeps a bare number when preferBare is set", () => {
    expect(rebuildLeaf("double", "1", { preferBare: true })).toEqual({ ok: true, value: 1 });
  });
  it("still wraps when preferBare is not set", () => {
    expect(rebuildLeaf("double", "1")).toEqual({ ok: true, value: { $numberDouble: "1" } });
  });
});

describe("emptyValue", () => {
  it("creates typed empty values", () => {
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

  it("ADDABLE_TYPES is the correct set (leaves + null + object + array, no binary)", () => {
    expect(ADDABLE_TYPES).toEqual([
      "string", "int", "long", "double", "decimal", "bool", "date", "objectId", "null", "object", "array",
    ]);
  });
});

describe("validateNewFieldName", () => {
  it("valid name → null", () => {
    expect(validateNewFieldName("newf", ["a", "b"])).toBeNull();
  });
  it("trims before checking", () => {
    expect(validateNewFieldName("  newf  ", ["a"])).toBeNull();
    expect(validateNewFieldName("  a  ", ["a"])).toBe("err_field_name_duplicate");
  });
  it("empty → error", () => {
    expect(validateNewFieldName("", ["a"])).toBe("err_field_name_empty");
    expect(validateNewFieldName("   ", ["a"])).toBe("err_field_name_empty");
  });
  it("duplicate key → error", () => {
    expect(validateNewFieldName("a", ["a", "b"])).toBe("err_field_name_duplicate");
  });
});
