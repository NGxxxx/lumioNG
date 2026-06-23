import { describe, it, expect } from "vitest";
import { rebuildNumber } from "./bsonnum";

describe("rebuildNumber", () => {
  it("valid int → $numberInt", () => {
    expect(rebuildNumber("int", "5")).toEqual({ ok: true, value: { $numberInt: "5" } });
    expect(rebuildNumber("int", "-2147483648")).toEqual({ ok: true, value: { $numberInt: "-2147483648" } });
    expect(rebuildNumber("int", "2147483647")).toEqual({ ok: true, value: { $numberInt: "2147483647" } });
  });
  it("invalid int / out of 32-bit range → error", () => {
    expect(rebuildNumber("int", "abc")).toEqual({ ok: false, error: "err_number_int32" });
    expect(rebuildNumber("int", "3000000000")).toEqual({ ok: false, error: "err_number_int32" });
    expect(rebuildNumber("int", "1.5")).toEqual({ ok: false, error: "err_number_int32" });
  });

  it("valid long → $numberLong", () => {
    expect(rebuildNumber("long", "9000000000")).toEqual({ ok: true, value: { $numberLong: "9000000000" } });
  });
  it("long with non-integer input → error", () => {
    expect(rebuildNumber("long", "1.5")).toEqual({ ok: false, error: "err_number_integer" });
  });
  it("long out of 64-bit range → error", () => {
    expect(rebuildNumber("long", "99999999999999999999999")).toEqual({
      ok: false,
      error: "err_number_int64_overflow",
    });
  });

  it("valid double → $numberDouble", () => {
    expect(rebuildNumber("double", "3.14")).toEqual({ ok: true, value: { $numberDouble: "3.14" } });
  });
  it("double empty/non-finite → error", () => {
    expect(rebuildNumber("double", "")).toEqual({ ok: false, error: "err_number_invalid" });
    expect(rebuildNumber("double", "abc")).toEqual({ ok: false, error: "err_number_invalid" });
  });

  it("valid decimal → $numberDecimal", () => {
    expect(rebuildNumber("decimal", "123.45")).toEqual({ ok: true, value: { $numberDecimal: "123.45" } });
    expect(rebuildNumber("decimal", "-7")).toEqual({ ok: true, value: { $numberDecimal: "-7" } });
  });
  it("decimal bad format → error", () => {
    expect(rebuildNumber("decimal", "1.2.3")).toEqual({ ok: false, error: "err_number_decimal_invalid" });
  });
});
