import { describe, it, expect } from "vitest";
import {
  flattenEditableDoc, getAtPath, existingKeysAt, setAtPath, removeAtPath, insertAtPath,
  type EditRow,
} from "./editTree";

function fieldPaths(rows: EditRow[]): string[] {
  return rows.filter((r): r is Extract<EditRow, { kind: "field" }> => r.kind === "field").map((r) => r.path);
}

describe("flattenEditableDoc", () => {
  const doc = { _id: { $oid: "507f1f77bcf86cd799439011" }, name: "Ann", address: { city: "Hue", zip: "1000" }, tags: ["a", "b"] };

  it("depth-0 rows are the document's own keys, collapsed by default (no nested rows)", () => {
    const rows = flattenEditableDoc(doc, new Set(), ["_id"]);
    expect(fieldPaths(rows)).toEqual(["_id", "name", "address", "tags"]);
    // Trailing root adder row.
    expect(rows.at(-1)).toEqual({ kind: "adder", path: "__add", segments: [], depth: 0, isArray: false });
  });

  it("marks _id locked/non-removable, other depth-0 fields removable", () => {
    const rows = flattenEditableDoc(doc, new Set(), ["_id"]);
    const byKey = Object.fromEntries(fieldPaths(rows).map((p, i) => [p, rows[i]]));
    const idRow = rows.find((r) => r.kind === "field" && r.key === "_id")!;
    expect((idRow as any).locked).toBe(true);
    expect((idRow as any).removable).toBe(false);
    const nameRow = rows.find((r) => r.kind === "field" && r.key === "name")!;
    expect((nameRow as any).locked).toBe(false);
    expect((nameRow as any).removable).toBe(true);
  });

  it("expands a container's children only when its path is in `open`, plus a nested adder row", () => {
    const rows = flattenEditableDoc(doc, new Set(["address"]), ["_id"]);
    const paths = fieldPaths(rows);
    expect(paths).toContain("address.city");
    expect(paths).toContain("address.zip");
    expect(paths).not.toContain("tags.0"); // "tags" not open
    const adderForAddress = rows.find((r) => r.kind === "adder" && r.path === "address.__add");
    expect(adderForAddress).toBeDefined();
    expect((adderForAddress as any).isArray).toBe(false);
  });

  it("array items use numeric segments and an isArray adder", () => {
    const rows = flattenEditableDoc(doc, new Set(["tags"]), ["_id"]);
    const item0 = rows.find((r) => r.kind === "field" && r.path === "tags.0") as any;
    expect(item0.segments).toEqual(["tags", 0]);
    expect(item0.key).toBe("0");
    const adder = rows.find((r) => r.kind === "adder" && r.path === "tags.__add") as any;
    expect(adder.isArray).toBe(true);
    expect(adder.segments).toEqual(["tags"]);
  });

  it("nested containers default closed even when a sibling/ancestor is open (bounded render cost)", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const rows = flattenEditableDoc(deep, new Set(["a"]), []);
    const paths = fieldPaths(rows);
    expect(paths).toContain("a.b");
    expect(paths).not.toContain("a.b.c"); // "a.b" itself not open
  });

  it("locked field suppresses its own nested adder even if somehow open", () => {
    const doc2 = { _id: { x: 1 } };
    const rows = flattenEditableDoc(doc2, new Set(["_id"]), ["_id"]);
    expect(rows.some((r) => r.kind === "adder" && r.path === "_id.__add")).toBe(false);
  });
});

describe("getAtPath / existingKeysAt", () => {
  const doc = { address: { city: "Hue" }, tags: ["a", "b"] };

  it("reads nested object and array values", () => {
    expect(getAtPath(doc, ["address", "city"])).toBe("Hue");
    expect(getAtPath(doc, ["tags", 1])).toBe("b");
  });
  it("returns undefined through a missing/scalar segment", () => {
    expect(getAtPath(doc, ["missing", "x"])).toBeUndefined();
    expect(getAtPath(doc, ["address", "city", "x"])).toBeUndefined();
  });
  it("lists existing keys of an object container, empty for arrays/missing", () => {
    expect(existingKeysAt(doc, ["address"])).toEqual(["city"]);
    expect(existingKeysAt(doc, ["tags"])).toEqual([]);
    expect(existingKeysAt(doc, ["nope"])).toEqual([]);
  });
});

describe("setAtPath", () => {
  it("replaces the whole root when segments is empty", () => {
    expect(setAtPath({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 });
  });
  it("sets a nested object field without disturbing siblings", () => {
    const doc = { address: { city: "Hue", zip: "1000" }, name: "x" };
    expect(setAtPath(doc, ["address", "city"], "Hanoi")).toEqual({
      address: { city: "Hanoi", zip: "1000" },
      name: "x",
    });
  });
  it("sets an array element by numeric segment", () => {
    expect(setAtPath({ tags: ["a", "b"] }, ["tags", 1], "z")).toEqual({ tags: ["a", "z"] });
  });
  it("does not mutate the original", () => {
    const doc = { address: { city: "Hue" } };
    const next = setAtPath(doc, ["address", "city"], "Hanoi") as typeof doc;
    expect(doc.address.city).toBe("Hue");
    expect(next).not.toBe(doc);
    expect(next.address).not.toBe(doc.address);
  });
});

describe("removeAtPath", () => {
  it("removes a top-level object key", () => {
    expect(removeAtPath({ a: 1, b: 2 }, ["a"])).toEqual({ b: 2 });
  });
  it("removes a nested object key", () => {
    expect(removeAtPath({ x: { a: 1, b: 2 } }, ["x", "a"])).toEqual({ x: { b: 2 } });
  });
  it("removes an array element, shifting later indices down", () => {
    expect(removeAtPath({ tags: ["a", "b", "c"] }, ["tags", 1])).toEqual({ tags: ["a", "c"] });
  });
});

describe("insertAtPath", () => {
  it("adds a keyed field to the root document", () => {
    expect(insertAtPath({ a: 1 }, [], "b", 2)).toEqual({ a: 1, b: 2 });
  });
  it("adds a keyed field into a nested object", () => {
    expect(insertAtPath({ x: { a: 1 } }, ["x"], "b", 2)).toEqual({ x: { a: 1, b: 2 } });
  });
  it("appends an item into a nested array (key null)", () => {
    expect(insertAtPath({ tags: ["a"] }, ["tags"], null, "b")).toEqual({ tags: ["a", "b"] });
  });
});
