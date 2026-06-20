import { describe, it, expect } from "vitest";
import { rebuildNumber } from "./bsonnum";

describe("rebuildNumber", () => {
  it("int hợp lệ → $numberInt", () => {
    expect(rebuildNumber("int", "5")).toEqual({ ok: true, value: { $numberInt: "5" } });
    expect(rebuildNumber("int", "-2147483648")).toEqual({ ok: true, value: { $numberInt: "-2147483648" } });
    expect(rebuildNumber("int", "2147483647")).toEqual({ ok: true, value: { $numberInt: "2147483647" } });
  });
  it("int sai/ngoài dải 32-bit → lỗi", () => {
    expect(rebuildNumber("int", "abc")).toEqual({ ok: false, error: "Cần số nguyên 32-bit." });
    expect(rebuildNumber("int", "3000000000")).toEqual({ ok: false, error: "Cần số nguyên 32-bit." });
    expect(rebuildNumber("int", "1.5")).toEqual({ ok: false, error: "Cần số nguyên 32-bit." });
  });

  it("long hợp lệ → $numberLong", () => {
    expect(rebuildNumber("long", "9000000000")).toEqual({ ok: true, value: { $numberLong: "9000000000" } });
  });
  it("long không phải số nguyên → lỗi", () => {
    expect(rebuildNumber("long", "1.5")).toEqual({ ok: false, error: "Cần số nguyên." });
  });
  it("long ngoài dải 64-bit → lỗi", () => {
    expect(rebuildNumber("long", "99999999999999999999999")).toEqual({
      ok: false,
      error: "Số vượt quá dải 64-bit.",
    });
  });

  it("double hợp lệ → $numberDouble", () => {
    expect(rebuildNumber("double", "3.14")).toEqual({ ok: true, value: { $numberDouble: "3.14" } });
  });
  it("double rỗng/không hữu hạn → lỗi", () => {
    expect(rebuildNumber("double", "")).toEqual({ ok: false, error: "Số không hợp lệ." });
    expect(rebuildNumber("double", "abc")).toEqual({ ok: false, error: "Số không hợp lệ." });
  });

  it("decimal hợp lệ → $numberDecimal", () => {
    expect(rebuildNumber("decimal", "123.45")).toEqual({ ok: true, value: { $numberDecimal: "123.45" } });
    expect(rebuildNumber("decimal", "-7")).toEqual({ ok: true, value: { $numberDecimal: "-7" } });
  });
  it("decimal sai dạng → lỗi", () => {
    expect(rebuildNumber("decimal", "1.2.3")).toEqual({ ok: false, error: "Số thập phân không hợp lệ." });
  });
});
