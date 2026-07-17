import { describe, it, expect } from "vitest";
import { validateCollectionName, validateDatabaseName, sortCollectionNames } from "./namespaces";

describe("validateCollectionName", () => {
  it("valid name → null", () => {
    expect(validateCollectionName("users")).toBeNull();
    expect(validateCollectionName("orders_2026")).toBeNull();
  });
  it("empty → err_coll_name_empty", () => {
    expect(validateCollectionName("")).toBe("err_coll_name_empty");
  });
  it("contains $ → err_coll_name_dollar", () => {
    expect(validateCollectionName("a$b")).toBe("err_coll_name_dollar");
  });
  it("starts with system. → err_coll_name_system", () => {
    expect(validateCollectionName("system.users")).toBe("err_coll_name_system");
  });
  it("contains null byte → err_coll_name_null_char", () => {
    expect(validateCollectionName("a\0b")).toBe("err_coll_name_null_char");
  });
});

describe("validateDatabaseName", () => {
  it("valid name → null", () => {
    expect(validateDatabaseName("shop")).toBeNull();
  });
  it("empty → err_db_name_empty", () => {
    expect(validateDatabaseName("")).toBe("err_db_name_empty");
  });
  it("contains forbidden chars → err_db_name_invalid_chars", () => {
    for (const bad of ["a/b", "a.b", "a b", "a$b", 'a"b', "a\\b"]) {
      expect(validateDatabaseName(bad)).toBe("err_db_name_invalid_chars");
    }
  });
  it("over 63 bytes → err_db_name_too_long", () => {
    expect(validateDatabaseName("x".repeat(64))).toBe("err_db_name_too_long");
  });
  it("counts bytes, not characters (multibyte)", () => {
    // 32 two-byte chars = 64 bytes > 63 → error, even though .length is only 32
    expect(validateDatabaseName("é".repeat(32))).toBe("err_db_name_too_long");
  });
});

describe("sortCollectionNames", () => {
  const names = ["zebra", "Apple", "mango"];

  it("default → returns the array unchanged (server order)", () => {
    expect(sortCollectionNames(names, "default")).toEqual(names);
  });
  it("asc → A-Z (locale-aware)", () => {
    expect(sortCollectionNames(names, "asc")).toEqual(["Apple", "mango", "zebra"]);
  });
  it("desc → Z-A", () => {
    expect(sortCollectionNames(names, "desc")).toEqual(["zebra", "mango", "Apple"]);
  });
  it("does not mutate the input array", () => {
    const copy = [...names];
    sortCollectionNames(names, "asc");
    expect(names).toEqual(copy);
  });
});
