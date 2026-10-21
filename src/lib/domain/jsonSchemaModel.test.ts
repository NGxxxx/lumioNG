import { describe, it, expect } from "vitest";
import {
  parseJsonSchema, toJsonSchema, fromSampledSchema, emptyNode, updateAt, addProperty, removeProperty,
  renameProperty, setRequired, violatorsFilter, splitValidator, joinValidator, flattenTree,
} from "./jsonSchemaModel";
import { inferSchema } from "./schema";

const rt = (x: object) => toJsonSchema(parseJsonSchema(x));

describe("jsonSchemaModel", () => {
  it("round_trips_unknown_keywords", () => {
    const x = {
      bsonType: "object",
      title: "User",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { bsonType: "string", minLength: 1, maxLength: 20, pattern: "^a", description: "n", title: "Name" },
        kind: { enum: ["a", "b", 3] },
        either: { oneOf: [{ bsonType: "int" }, { bsonType: "string" }] },
        age: { bsonType: ["int", "null"], minimum: 0, maximum: 150, exclusiveMinimum: true },
      },
      dependencies: { name: ["kind"] },
      anyOf: [{ required: ["name"] }],
    };
    expect(rt(x)).toEqual(x);
    expect(parseJsonSchema(x).extra).toMatchObject({ title: "User", additionalProperties: false });
  });

  it("round_trips minimal and empty schemas", () => {
    expect(rt({})).toEqual({});
    expect(rt({ bsonType: ["string"] })).toEqual({ bsonType: "string" });
  });

  it("keeps a malformed known keyword in extra instead of dropping it", () => {
    const x = { bsonType: "object", minimum: "oops", properties: 5 };
    expect(rt(x)).toEqual(x);
  });

  it("keeps EJSON numeric wrappers verbatim and lets a typed edit supersede them", () => {
    const x = { minimum: { $numberLong: "9007199254740993" }, maxLength: { $numberDouble: "5.0" }, minLength: 2 };
    const n = parseJsonSchema(x);
    expect(n.minimum).toBeUndefined();
    expect(n.minLength).toBe(2);
    expect(toJsonSchema(n)).toEqual(x);
    expect(toJsonSchema(updateAt(n, [], { minimum: 3 })).minimum).toBe(3);
    expect(toJsonSchema(updateAt(n, [], { maxLength: undefined }))).not.toHaveProperty("maxLength");
  });

  it("nested_objects_and_arrays", () => {
    const x = {
      bsonType: "object",
      required: ["addr"],
      properties: {
        addr: { bsonType: "object", required: ["zip"], properties: { zip: { bsonType: "string" } } },
        tags: { bsonType: "array", items: { bsonType: "string", maxLength: 5 } },
        grid: { bsonType: "array", items: { bsonType: "array", items: { bsonType: "int" } } },
      },
    };
    const n = parseJsonSchema(x);
    expect(n.properties.addr.properties.zip.bsonType).toEqual(["string"]);
    expect(n.properties.tags.items?.maxLength).toBe(5);
    expect(n.properties.grid.items?.items?.bsonType).toEqual(["int"]);
    expect(toJsonSchema(n)).toEqual(x);
  });

  it("mixed_types_become_bsonType_array", () => {
    const docs = [{ x: { $numberInt: "1" } }, { x: "a" }, { x: { $numberInt: "2" } }, { x: null }];
    const n = fromSampledSchema(inferSchema(docs), { requiredThreshold: 0.99 });
    expect([...n.properties.x.bsonType].sort()).toEqual(["int", "null", "string"]);
    expect(toJsonSchema(n)).toMatchObject({ properties: { x: { bsonType: expect.any(Array) } } });
  });

  it("from_sample_marks_required_by_threshold", () => {
    const docs = Array.from({ length: 100 }, (_, i) => (i < 50 ? { a: 1, b: 2 } : { a: 1 }));
    const n = fromSampledSchema(inferSchema(docs), { requiredThreshold: 0.99 });
    expect(n.required).toEqual(["a"]);
    const lax = fromSampledSchema(inferSchema(docs), { requiredThreshold: 0.5 });
    expect(lax.required).toEqual(["a", "b"]);
    expect(n.bsonType).toEqual(["object"]);
  });

  it("from_sample maps names and nests dotted paths", () => {
    const docs = [{ _id: { $oid: "a".repeat(24) }, u: { n: "x", d: { $date: "2020-01-01T00:00:00Z" } }, b: { $binary: { base64: "AA==", subType: "00" } }, t: [1] }];
    const n = fromSampledSchema(inferSchema(docs), { requiredThreshold: 0.99 });
    expect(n.properties._id.bsonType).toEqual(["objectId"]);
    expect(n.properties.u.bsonType).toEqual(["object"]);
    expect(n.properties.u.required).toEqual(["n", "d"]);
    expect(n.properties.u.properties.d.bsonType).toEqual(["date"]);
    expect(n.properties.b.bsonType).toEqual(["binData"]);
    expect(n.properties.t.bsonType).toEqual(["array"]);
  });

  it("edit helpers are immutable", () => {
    const root = parseJsonSchema({ bsonType: "object", properties: { a: { bsonType: "string" } } });
    const r2 = addProperty(root, [], "b");
    expect(Object.keys(root.properties)).toEqual(["a"]);
    expect(Object.keys(r2.properties)).toEqual(["a", "b"]);
    const r3 = updateAt(r2, ["a"], { bsonType: ["int"], minimum: 3 });
    expect(toJsonSchema(r3)).toMatchObject({ properties: { a: { bsonType: "int", minimum: 3 } } });
    const r4 = setRequired(r3, [], "a", true);
    expect(r4.required).toEqual(["a"]);
    const r5 = renameProperty(r4, [], "a", "z");
    expect(r5.required).toEqual(["z"]);
    expect(Object.keys(r5.properties)).toEqual(["z", "b"]);
    const r6 = removeProperty(r5, [], "z");
    expect(r6.required).toEqual([]);
    expect(Object.keys(r6.properties)).toEqual(["b"]);
    expect(emptyNode().bsonType).toEqual([]);
  });

  it("splits and joins a validator, keeping non-schema operators", () => {
    const v = { $jsonSchema: { bsonType: "object" }, price: { $gt: 0 } };
    const { schema, rest } = splitValidator(v);
    expect(schema).toEqual({ bsonType: "object" });
    expect(joinValidator(schema, rest)).toEqual(v);
    expect(splitValidator({}).schema).toBeNull();
    expect(joinValidator(null, {})).toEqual({});
  });

  it("builds the violators filter", () => {
    const v = { $jsonSchema: { bsonType: "object" }, p: { $gt: 1 } };
    expect(violatorsFilter(v)).toEqual({ $nor: [v] });
  });

  it("flattens the tree depth-first including array items", () => {
    const n = parseJsonSchema({ bsonType: "object", required: ["a"], properties: { a: { bsonType: "object", properties: { b: { bsonType: "int" } } }, t: { bsonType: "array", items: { bsonType: "string" } } } });
    expect(flattenTree(n).map((r) => [r.path.join("/"), r.depth, r.required])).toEqual([
      ["a", 0, true], ["a/b", 1, false], ["t", 0, false], ["t/[]", 1, false],
    ]);
  });
});
