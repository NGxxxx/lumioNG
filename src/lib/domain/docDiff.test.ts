import { describe, it, expect } from "vitest";
import { diffDocs, formatChange } from "./docDiff";

describe("diffDocs", () => {
  it("identical → []", () => {
    expect(diffDocs({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toEqual([]);
  });
  it("scalar change", () => {
    expect(diffDocs({ status: "pending" }, { status: "shipped" })).toEqual([
      { path: "status", kind: "changed", before: "pending", after: "shipped" },
    ]);
  });
  it("nested path", () => {
    const r = diffDocs({ customer: { email: "a" } }, { customer: { email: "b" } });
    expect(r.map((c) => c.path)).toEqual(["customer.email"]);
  });
  it("array element by index", () => {
    const r = diffDocs({ items: [{ qty: 1 }, { qty: 1 }, { qty: 1 }] }, { items: [{ qty: 1 }, { qty: 1 }, { qty: 2 }] });
    expect(r).toEqual([{ path: "items.2.qty", kind: "changed", before: 1, after: 2 }]);
  });
  it("array grown → added items.3", () => {
    const r = diffDocs({ items: [1, 2, 3] }, { items: [1, 2, 3, 4] });
    expect(r).toEqual([{ path: "items.3", kind: "added", after: 4 }]);
  });
  it("array shrunk → removed", () => {
    expect(diffDocs({ items: [1, 2] }, { items: [1] })).toEqual([{ path: "items.1", kind: "removed", before: 2 }]);
  });
  it("added and removed keys", () => {
    const r = diffDocs({ notes: "x" }, { giftWrap: true });
    expect(r).toEqual([
      { path: "notes", kind: "removed", before: "x" },
      { path: "giftWrap", kind: "added", after: true },
    ]);
  });
  it("$numberInt vs $numberLong is a change", () => {
    const r = diffDocs({ n: { $numberInt: "5" } }, { n: { $numberLong: "5" } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: "n", kind: "changed" });
  });
  it("key order only → []", () => {
    expect(diffDocs({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
  it("ExtJSON wrapper is a leaf", () => {
    const r = diffDocs({ total: { $numberDecimal: "1.0" } }, { total: { $numberDecimal: "2.0" } });
    expect(r.map((c) => c.path)).toEqual(["total"]);
  });
  it("type change container → scalar is one change", () => {
    const r = diffDocs({ a: { b: 1 } }, { a: 5 });
    expect(r).toEqual([{ path: "a", kind: "changed", before: { b: 1 }, after: 5 }]);
  });
});

describe("formatChange", () => {
  it("changed", () => {
    expect(formatChange({ path: "status", kind: "changed", before: "pending", after: "shipped" })).toBe('status: "pending" → "shipped"');
  });
  it("added", () => {
    expect(formatChange({ path: "giftWrap", kind: "added", after: true })).toBe("+ giftWrap: true");
  });
  it("removed", () => {
    expect(formatChange({ path: "notes", kind: "removed", before: "x" })).toBe("− notes");
  });
});
