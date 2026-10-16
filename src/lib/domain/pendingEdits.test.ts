import { describe, it, expect } from "vitest";
import { stageEdit, overlayPending, pendingKeys, pendingKey, type PendingEdit } from "./pendingEdits";

const e = (idJson: string, path: string, before: unknown, after: unknown): PendingEdit => ({ idJson, path, before, after });

describe("stageEdit", () => {
  it("appends a new edit", () => {
    expect(stageEdit([], e("1", "a", 1, 2))).toEqual([e("1", "a", 1, 2)]);
  });

  it("re-editing a cell keeps the original value and moves it to the end (commit order = last edit order)", () => {
    const list = [e("1", "a", 1, 2), e("2", "b", "x", "y")];
    expect(stageEdit(list, e("1", "a", 2, 3))).toEqual([e("2", "b", "x", "y"), e("1", "a", 1, 3)]);
  });

  it("editing a cell back to its original value un-stages it", () => {
    const list = [e("1", "a", { $numberInt: "1" }, { $numberInt: "2" })];
    expect(stageEdit(list, e("1", "a", { $numberInt: "2" }, { $numberInt: "1" }))).toEqual([]);
  });

  it("a no-op edit is not staged", () => {
    expect(stageEdit([], e("1", "a", "same", "same"))).toEqual([]);
  });

  it("never mutates its input", () => {
    const list = [e("1", "a", 1, 2)];
    stageEdit(list, e("1", "a", 2, 3));
    expect(list).toEqual([e("1", "a", 1, 2)]);
  });
});

describe("overlayPending", () => {
  const docs = [{ _id: 1, a: 1, n: { x: 1 } }, { _id: 2, a: 5 }];

  it("applies staged values to the matching documents only, immutably", () => {
    const out = overlayPending(docs, [e("1", "a", 1, 9), e("1", "n.x", 1, 7)]);
    expect(out).toEqual([{ _id: 1, a: 9, n: { x: 7 } }, { _id: 2, a: 5 }]);
    expect(out[1]).toBe(docs[1]);
    expect(docs[0]).toEqual({ _id: 1, a: 1, n: { x: 1 } });
  });

  it("returns the same array when nothing is staged for these documents", () => {
    expect(overlayPending(docs, [])).toBe(docs);
    expect(overlayPending(docs, [e("99", "a", 0, 1)])).toBe(docs);
  });

  it("matches documents by their canonical _id (ObjectId)", () => {
    const d = [{ _id: { $oid: "abc" }, a: 1 }];
    expect(overlayPending(d, [e('{"$oid":"abc"}', "a", 1, 2)])).toEqual([{ _id: { $oid: "abc" }, a: 2 }]);
  });
});

describe("pendingKeys", () => {
  it("is the set of id+path keys", () => {
    expect(pendingKeys([e("1", "a", 0, 1), e("2", "b.c", 0, 1)])).toEqual(new Set([pendingKey("1", "a"), pendingKey("2", "b.c")]));
  });
});
