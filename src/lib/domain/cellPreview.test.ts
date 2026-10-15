import { describe, it, expect } from "vitest";
import { previewCell } from "./cellPreview";

describe("previewCell", () => {
  it("object → key: value pairs", () => {
    const r = previewCell({ name: "Lena Fischer", email: "a@b.c" });
    expect(r.text).toBe("{ name: Lena Fischer, email: a@b.c }");
    expect(r.kind).toBe("object");
  });
  it("array of objects → [n] first element…", () => {
    const items = Array.from({ length: 5 }, () => ({ sku: "S", qty: { $numberInt: "1" } }));
    const r = previewCell(items);
    expect(r.text.startsWith("[5] { sku: S, qty: 1 }")).toBe(true);
    expect(r.kind).toBe("array");
  });
  it("empty array → [ ]", () => {
    expect(previewCell([]).text).toBe("[ ]");
  });
  it("nested containers inside previews collapse", () => {
    expect(previewCell({ a: { b: 1 }, c: [1] }).text).toBe("{ a: {…}, c: […] }");
  });
  it("objectId → full hex", () => {
    const hex = "652f0a1b2c3d4e5f60718293";
    const r = previewCell({ $oid: hex });
    expect(r.text).toBe(hex);
    expect(r.kind).toBe("objectId");
  });
  it("date → local YYYY-MM-DD HH:mm with ISO title", () => {
    const r = previewCell({ $date: { $numberLong: "1760277720000" } });
    expect(r.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r.title).toBe(new Date(1760277720000).toISOString());
    expect(r.kind).toBe("date");
  });
  it("long keeps exact digits and right-aligns", () => {
    const r = previewCell({ $numberLong: "9007199254740993" });
    expect(r.text).toBe("9007199254740993");
    expect(r.align).toBe("right");
  });
  it("decimal keeps exact text", () => {
    const r = previewCell({ $numberDecimal: "0.10" });
    expect(r.text).toBe("0.10");
    expect(r.align).toBe("right");
  });
  it("strings are left-aligned", () => {
    expect(previewCell("hi").align).toBe("left");
  });
  it("null and missing", () => {
    expect(previewCell(null)).toMatchObject({ text: "null", kind: "null" });
    expect(previewCell(undefined)).toMatchObject({ text: "—", kind: "missing" });
  });
  it("huge array and deep nesting stay capped and fast", () => {
    const big = Array.from({ length: 10000 }, (_, i) => i);
    let deep: unknown = 1;
    for (let i = 0; i < 50; i++) deep = { k: deep };
    const t0 = performance.now();
    const a = previewCell(big);
    const b = previewCell(deep);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(a.text.length).toBeLessThanOrEqual(120);
    expect(b.text.length).toBeLessThanOrEqual(120);
  });
  it("long strings are truncated to max", () => {
    expect(previewCell("x".repeat(500)).text.length).toBeLessThanOrEqual(120);
  });

  it("cost does not grow with a huge value inside a container (no full stringify)", () => {
    const big = { blob: "x".repeat(5_000_000), n: 1 };
    const t0 = performance.now();
    const p = previewCell(big);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(p.kind).toBe("object");
    expect(p.text.length).toBeLessThanOrEqual(120);
  });
});
