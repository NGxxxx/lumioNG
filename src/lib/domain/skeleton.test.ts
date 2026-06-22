import { describe, it, expect } from "vitest";
import { buildSkeleton, duplicateForInsert } from "./skeleton";

describe("buildSkeleton", () => {
  it("excludes _id and fills typed empty values", () => {
    const doc = buildSkeleton([
      { path: "_id", type: "objectId" },
      { path: "name", type: "string" },
      { path: "age", type: "int" },
      { path: "active", type: "bool" },
    ]);
    expect(doc).toEqual({ name: "", age: { $numberInt: "0" }, active: false });
  });

  it("reconstructs nested objects from dot-paths", () => {
    const doc = buildSkeleton([
      { path: "address.city", type: "string" },
      { path: "address.zip", type: "int" },
    ]);
    expect(doc).toEqual({ address: { city: "", zip: { $numberInt: "0" } } });
  });

  it("uses [] and {} for array/object leaf fields", () => {
    const doc = buildSkeleton([
      { path: "tags", type: "array" },
      { path: "meta", type: "object" },
    ]);
    expect(doc).toEqual({ tags: [], meta: {} });
  });

  it("falls back to null for unsupported or missing types", () => {
    const doc = buildSkeleton([{ path: "blob", type: "binary" }, { path: "mystery" }]);
    expect(doc).toEqual({ blob: null, mystery: null });
  });
});

describe("duplicateForInsert", () => {
  it("drops _id and deep-clones the rest", () => {
    const src = { _id: { $oid: "aa" }, name: "x", nested: { a: 1 } };
    const dup = duplicateForInsert(src);
    expect(dup).toEqual({ name: "x", nested: { a: 1 } });
    expect("_id" in dup).toBe(false);
    // deep clone: mutating the source must not affect the duplicate
    (src.nested as { a: number }).a = 2;
    expect((dup.nested as { a: number }).a).toBe(1);
  });
});
