import { describe, it, expect } from "vitest";
import { getByPath, getBySegments, flattenPaths, inferSchema, mergeColumns, limitColumnsToDepth, topLevelFieldNames } from "./schema";

describe("getByPath", () => {
  it("reads a top-level field", () => {
    expect(getByPath({ name: "a" }, "name")).toBe("a");
  });
  it("reads a nested dot-path", () => {
    expect(getByPath({ address: { city: "HCM" } }, "address.city")).toBe("HCM");
  });
  it("missing path → undefined", () => {
    expect(getByPath({ address: { city: "HCM" } }, "address.zip")).toBeUndefined();
    expect(getByPath({ x: 1 }, "y")).toBeUndefined();
  });
  it("scalar mid-path or missing array index → undefined", () => {
    expect(getByPath({ a: 5 }, "a.b")).toBeUndefined();
    expect(getByPath({ a: [1, 2] }, "a.b")).toBeUndefined();
  });
  it("array index segment resolves the element", () => {
    expect(getByPath({ tags: ["a", "b"] }, "tags.1")).toBe("b");
    expect(getByPath({ a: [{ b: 1 }] }, "a.0.b")).toBe(1);
  });
});

describe("getBySegments", () => {
  it("reads a nested value from pre-split segments", () => {
    expect(getBySegments({ address: { city: "HCM" } }, ["address", "city"])).toBe("HCM");
  });
  it("matches getByPath semantics for missing and scalar-mid-path", () => {
    expect(getBySegments({ address: { city: "HCM" } }, ["address", "zip"])).toBeUndefined();
    expect(getBySegments({ a: 5 }, ["a", "b"])).toBeUndefined();
    expect(getBySegments({ a: [1, 2] }, ["a", "b"])).toBeUndefined();
  });
});

describe("flattenPaths", () => {
  it("top-level scalars with _id first", () => {
    expect(flattenPaths([{ name: "a", _id: { $oid: "1" } }])).toEqual(["_id", "name"]);
  });
  it("flattens nested objects to dot-paths", () => {
    const docs = [{ _id: { $oid: "1" }, address: { city: "HCM", zip: "70000" } }];
    expect(flattenPaths(docs)).toEqual(["_id", "address.city", "address.zip"]);
  });
  it("array is a leaf — does not recurse", () => {
    const docs = [{ _id: { $oid: "1" }, tags: ["x", "y"], items: [{ a: 1 }] }];
    expect(flattenPaths(docs)).toEqual(["_id", "tags", "items"]);
  });
  it("empty object is a leaf", () => {
    expect(flattenPaths([{ meta: {} }])).toEqual(["meta"]);
  });
  it("merges paths across docs in discovery order", () => {
    const docs = [{ _id: { $oid: "1" }, a: 1 }, { _id: { $oid: "2" }, b: 2 }];
    expect(flattenPaths(docs)).toEqual(["_id", "a", "b"]);
  });
});

describe("inferSchema", () => {
  it("infers dominant type and presence for top-level fields", () => {
    const docs = [
      { _id: { $oid: "1" }, name: "a", age: { $numberInt: "1" } },
      { _id: { $oid: "2" }, name: "b" },
    ];
    const s = inferSchema(docs);
    expect(s.sampleSize).toBe(2);
    const name = s.fields.find((f) => f.path === "name")!;
    expect(name.type).toBe("string");
    expect(name.mixed).toBe(false);
    expect(name.presence).toBe(1);
    const age = s.fields.find((f) => f.path === "age")!;
    expect(age.type).toBe("int");
    expect(age.presence).toBe(0.5);
  });
  it("_id is always first", () => {
    const s = inferSchema([{ a: 1, _id: { $oid: "1" } }]);
    expect(s.fields[0].path).toBe("_id");
  });
  it("multiple types across docs → dominant + mixed flag", () => {
    const docs = [{ x: "s" }, { x: { $numberInt: "1" } }, { x: "t" }];
    const x = inferSchema(docs).fields.find((f) => f.path === "x")!;
    expect(x.type).toBe("string");
    expect(x.mixed).toBe(true);
  });
  it("ExtJSON wrappers are typed leaves — no recursion", () => {
    const docs = [
      {
        oid: { $oid: "1" },
        when: { $date: "2020-01-01T00:00:00Z" },
        big: { $numberLong: "9" },
        bin: { $binary: { base64: "AAAA", subType: "00" } },
      },
    ];
    const s = inferSchema(docs);
    const paths = s.fields.map((f) => f.path);
    expect(paths).toEqual(["oid", "when", "big", "bin"]);
    expect(s.fields.find((f) => f.path === "oid")!.type).toBe("objectId");
    expect(s.fields.find((f) => f.path === "when")!.type).toBe("date");
    expect(s.fields.find((f) => f.path === "big")!.type).toBe("long");
    expect(s.fields.find((f) => f.path === "bin")!.type).toBe("binary");
  });
  it("field sometimes object, sometimes scalar → both parent and child paths appear", () => {
    const docs = [{ a: 5 }, { a: { b: 1 } }];
    const paths = inferSchema(docs).fields.map((f) => f.path);
    expect(paths).toContain("a");
    expect(paths).toContain("a.b");
  });
  it("empty docs → sampleSize 0, no fields (no divide-by-zero)", () => {
    expect(inferSchema([])).toEqual({ sampleSize: 0, fields: [] });
  });
});

describe("mergeColumns", () => {
  it("null schema → row-derived columns (no metadata)", () => {
    const cols = mergeColumns(null, [{ _id: { $oid: "1" }, x: 1 }]);
    expect(cols.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(cols[1].type).toBeUndefined();
  });
  it("extra fields not in schema are appended last, with no metadata", () => {
    const schema = inferSchema([{ _id: { $oid: "1" }, x: 1 }]);
    const cols = mergeColumns(schema, [{ _id: { $oid: "1" }, x: 1, extra: 9 }]);
    const extra = cols.find((c) => c.path === "extra")!;
    expect(cols[cols.length - 1].path).toBe("extra");
    expect(extra.type).toBeUndefined();
    expect(cols.find((c) => c.path === "x")!.type).toBeDefined();
  });
});

describe("limitColumnsToDepth", () => {
  it("null maxDepth returns the columns unchanged", () => {
    const cols = [{ path: "_id" }, { path: "a.b.c" }];
    expect(limitColumnsToDepth(cols, null)).toEqual(cols);
  });

  it("keeps shallow columns and collapses deeper ones to their prefix with type object", () => {
    const cols = [
      { path: "_id", type: "objectId" as const },
      { path: "name", type: "string" as const },
      { path: "address.city", type: "string" as const },
    ];
    expect(limitColumnsToDepth(cols, 1)).toEqual([
      { path: "_id", type: "objectId" },
      { path: "name", type: "string" },
      { path: "address", type: "object" },
    ]);
  });

  it("dedupes deep paths sharing one prefix, preserving first-seen order", () => {
    const cols = [{ path: "a.b.c" }, { path: "z" }, { path: "a.b.d" }, { path: "a.x" }];
    expect(limitColumnsToDepth(cols, 1)).toEqual([{ path: "a", type: "object" }, { path: "z" }]);
  });

  it("depth 2 truncates to two segments", () => {
    const cols = [{ path: "a.b.c.d" }, { path: "a.b.e" }, { path: "a.k" }];
    expect(limitColumnsToDepth(cols, 2)).toEqual([{ path: "a.b", type: "object" }, { path: "a.k" }]);
  });

  it("mixed shape: the first column seen at a path keeps its metadata", () => {
    const cols = [{ path: "a", type: "string" as const, mixed: true, presence: 0.5 }, { path: "a.b" }];
    expect(limitColumnsToDepth(cols, 1)).toEqual([{ path: "a", type: "string", mixed: true, presence: 0.5 }]);
  });
});

describe("topLevelFieldNames", () => {
  it("returns paths as-is when none are dotted", () => {
    expect(topLevelFieldNames(["name", "age"])).toEqual(["name", "age"]);
  });

  it("drops any path containing a dot", () => {
    expect(topLevelFieldNames(["name", "customer.address.city", "age"])).toEqual(["name", "age"]);
  });

  it("returns an empty array when every path is dotted", () => {
    expect(topLevelFieldNames(["customer.address.city", "a.b"])).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(topLevelFieldNames([])).toEqual([]);
  });

  it("defaults exclude to [] so existing no-argument call sites are unaffected", () => {
    expect(topLevelFieldNames(["_id", "name"])).toEqual(["_id", "name"]);
  });

  it("drops names given in exclude, alongside the dotted-path filter", () => {
    expect(topLevelFieldNames(["_id", "name", "customer.address.city"], ["_id"])).toEqual(["name"]);
  });
});
