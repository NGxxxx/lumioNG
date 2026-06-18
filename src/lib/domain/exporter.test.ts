import { describe, it, expect } from "vitest";
import { escapeCsv, csvCell, toCsv, toJsonArray } from "./exporter";

describe("escapeCsv", () => {
  it("leaves plain text untouched", () => {
    expect(escapeCsv("hello")).toBe("hello");
  });
  it("quotes when comma present", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
  });
  it("quotes and doubles inner quotes", () => {
    expect(escapeCsv('a"b')).toBe('"a""b"');
  });
  it("quotes when newline present", () => {
    expect(escapeCsv("a\nb")).toBe('"a\nb"');
  });
});

describe("csvCell", () => {
  it("undefined → empty", () => {
    expect(csvCell(undefined)).toBe("");
  });
  it("null → 'null'", () => {
    expect(csvCell(null)).toBe("null");
  });
  it("string → verbatim", () => {
    expect(csvCell("hi")).toBe("hi");
  });
  it("objectId → hex", () => {
    expect(csvCell({ $oid: "507f1f77bcf86cd799439011" })).toBe("507f1f77bcf86cd799439011");
  });
  it("int wrapper → number string", () => {
    expect(csvCell({ $numberInt: "5" })).toBe("5");
  });
  it("array → full JSON", () => {
    expect(csvCell([1, 2])).toBe("[1,2]");
  });
  it("plain object → full JSON", () => {
    expect(csvCell({ a: 1 })).toBe('{"a":1}');
  });
});

describe("toCsv", () => {
  it("empty docs → empty string", () => {
    expect(toCsv([])).toBe("");
  });
  it("header is union of leaf paths with _id first; missing → empty cell", () => {
    const docs = [
      { _id: { $oid: "a" }, name: "x" },
      { _id: { $oid: "b" }, age: { $numberInt: "3" } },
    ];
    const lines = toCsv(docs).split("\n");
    expect(lines[0]).toBe("_id,name,age");
    expect(lines[1]).toBe("a,x,");
    expect(lines[2]).toBe("b,,3");
  });
  it("nested doc → dot-path column", () => {
    const docs = [{ _id: { $oid: "a" }, p: { city: "Hanoi" } }];
    const lines = toCsv(docs).split("\n");
    expect(lines[0]).toBe("_id,p.city");
    expect(lines[1]).toBe("a,Hanoi");
  });
});

describe("toJsonArray", () => {
  it("round-trips via JSON.parse", () => {
    const docs = [{ _id: { $oid: "a" }, x: 1 }];
    expect(JSON.parse(toJsonArray(docs))).toEqual(docs);
  });
});
