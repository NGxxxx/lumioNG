import { describe, it, expect } from "vitest";
import { validateCollectionName, validateDatabaseName } from "./namespaces";

describe("validateCollectionName", () => {
  it("tên hợp lệ → null", () => {
    expect(validateCollectionName("users")).toBeNull();
    expect(validateCollectionName("orders_2026")).toBeNull();
  });
  it("rỗng → lỗi", () => {
    expect(validateCollectionName("")).not.toBeNull();
  });
  it("chứa $ → lỗi", () => {
    expect(validateCollectionName("a$b")).not.toBeNull();
  });
  it("bắt đầu system. → lỗi", () => {
    expect(validateCollectionName("system.users")).not.toBeNull();
  });
  it("chứa null byte → lỗi", () => {
    expect(validateCollectionName("a\0b")).not.toBeNull();
  });
});

describe("validateDatabaseName", () => {
  it("tên hợp lệ → null", () => {
    expect(validateDatabaseName("shop")).toBeNull();
  });
  it("rỗng → lỗi", () => {
    expect(validateDatabaseName("")).not.toBeNull();
  });
  it("chứa ký tự cấm → lỗi", () => {
    for (const bad of ["a/b", "a.b", "a b", "a$b", 'a"b', "a\\b"]) {
      expect(validateDatabaseName(bad)).not.toBeNull();
    }
  });
  it("quá 63 byte → lỗi", () => {
    expect(validateDatabaseName("x".repeat(64))).not.toBeNull();
  });
  it("đếm theo byte, không theo ký tự (multibyte)", () => {
    // 32 ký tự 2-byte = 64 byte > 63 → lỗi, dù .length chỉ là 32
    expect(validateDatabaseName("é".repeat(32))).not.toBeNull();
  });
});
