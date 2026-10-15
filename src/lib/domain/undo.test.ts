import { describe, it, expect } from "vitest";
import { hasConflict, inverseUpdate, describeUndo, type UndoEntry } from "./undo";

const meta = { id: 1, sessionId: "s", db: "d", coll: "c", at: 0 };
type Cell = Extract<UndoEntry, { kind: "cell" }>;
const cell = (before: unknown, after: unknown, path = "a.b"): Cell => ({
  ...meta, kind: "cell", idJson: '{"$oid":"652f0a1b2c3d4e5f60718293"}', path, before, after,
});

describe("hasConflict", () => {
  it("replace: conflict when current differs from after", () => {
    const e: UndoEntry = { ...meta, kind: "replace", before: { _id: 1, n: 1 }, after: { _id: 1, n: 2 } };
    expect(hasConflict(e, { _id: 1, n: 2 })).toBe(false);
    expect(hasConflict(e, { _id: 1, n: 3 })).toBe(true);
    expect(hasConflict(e, null)).toBe(true);
  });
  it("replace: key order does not matter", () => {
    const e: UndoEntry = { ...meta, kind: "replace", before: { _id: 1 }, after: { a: 1, b: { x: 1, y: 2 } } };
    expect(hasConflict(e, { b: { y: 2, x: 1 }, a: 1 })).toBe(false);
  });
  it("cell: compares the value at the path only", () => {
    const e = cell(1, 2);
    expect(hasConflict(e, { a: { b: 2 }, other: 9 })).toBe(false);
    expect(hasConflict(e, { a: { b: 5 } })).toBe(true);
    expect(hasConflict(e, null)).toBe(true);
  });
  it("cell: missing after-value is matched by a missing path", () => {
    expect(hasConflict(cell(1, undefined), { a: {} })).toBe(false);
    expect(hasConflict(cell(1, undefined), { a: { b: 1 } })).toBe(true);
  });
  it("insert: conflict when the doc changed or is gone", () => {
    const e: UndoEntry = { ...meta, kind: "insert", doc: { _id: 1, n: 1 } };
    expect(hasConflict(e, { _id: 1, n: 1 })).toBe(false);
    expect(hasConflict(e, { _id: 1, n: 2 })).toBe(true);
    expect(hasConflict(e, null)).toBe(true);
  });
  it("delete: never a conflict", () => {
    const e: UndoEntry = { ...meta, kind: "delete", docs: [{ _id: 1 }] };
    expect(hasConflict(e, null)).toBe(false);
    expect(hasConflict(e, { _id: 1 })).toBe(false);
  });
});

describe("inverseUpdate", () => {
  it("$set the previous value (Extended JSON kept)", () => {
    expect(JSON.parse(inverseUpdate(cell({ $numberLong: "9007199254740993" }, 2)))).toEqual({
      $set: { "a.b": { $numberLong: "9007199254740993" } },
    });
  });
  it("$unset when there was no previous value", () => {
    expect(JSON.parse(inverseUpdate(cell(undefined, 2)))).toEqual({ $unset: { "a.b": "" } });
  });
  it("null before is a real value", () => {
    expect(JSON.parse(inverseUpdate(cell(null, 2)))).toEqual({ $set: { "a.b": null } });
  });
});

describe("describeUndo", () => {
  it("key per kind, count of documents", () => {
    expect(describeUndo({ ...meta, kind: "replace", before: {}, after: {} })).toEqual({ key: "undo_replace", count: 1 });
    expect(describeUndo(cell(1, 2))).toMatchObject({ key: "undo_cell", count: 1 });
    expect(describeUndo(cell(1, 2)).path).toBeDefined();
    expect(describeUndo({ ...meta, kind: "insert", doc: {} })).toEqual({ key: "undo_insert", count: 1 });
    expect(describeUndo({ ...meta, kind: "delete", docs: [{}, {}, {}] })).toEqual({ key: "undo_delete", count: 3 });
  });

  it("numbers compare by value across ExtJSON representations", () => {
    const e = { id: 1, sessionId: "s", db: "d", coll: "c", at: 0, kind: "cell" as const, idJson: "1", path: "n", before: 1, after: { $numberDouble: "2" } };
    expect(hasConflict(e, { _id: 1, n: { $numberDouble: "2.0" } })).toBe(false);
    expect(hasConflict(e, { _id: 1, n: { $numberDouble: "3" } })).toBe(true);
    const r = { id: 2, sessionId: "s", db: "d", coll: "c", at: 0, kind: "insert" as const, doc: { _id: 1, n: 5 } };
    expect(hasConflict(r, { _id: { $numberInt: "1" }, n: { $numberInt: "5" } })).toBe(false);
  });
});
