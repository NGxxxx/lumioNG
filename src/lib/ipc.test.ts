import { describe, it, expect } from "vitest";
import { idJson, errorMessage } from "./ipc";

describe("idJson", () => {
  it("trả _id dạng Canonical ExtJSON", () => {
    expect(idJson({ _id: { $oid: "507f1f77bcf86cd799439011" }, x: 1 })).toBe(
      '{"$oid":"507f1f77bcf86cd799439011"}'
    );
  });
  it("không có _id → null", () => {
    expect(idJson({ x: 1 })).toBeNull();
  });
});

describe("errorMessage", () => {
  it("AppError.Parse hiển thị kind + message", () => {
    expect(errorMessage({ kind: "Parse", message: "JSON không hợp lệ" })).toBe(
      "Parse: JSON không hợp lệ"
    );
  });
});
