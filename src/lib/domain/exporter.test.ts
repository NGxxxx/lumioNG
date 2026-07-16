import { describe, it, expect } from "vitest";
import { escapeCsv, csvCell, toCsv, toJsonArray, toSql, sqlLiteral, escapeSqlString } from "./exporter";

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

describe("escapeSqlString", () => {
  it("doubles embedded single quotes", () => {
    expect(escapeSqlString("O'Brien")).toBe("O''Brien");
  });
  it("leaves plain text untouched", () => {
    expect(escapeSqlString("hello")).toBe("hello");
  });
});

describe("sqlLiteral", () => {
  it("null/undefined -> NULL", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
  });
  it("boolean -> TRUE/FALSE", () => {
    expect(sqlLiteral(true)).toBe("TRUE");
    expect(sqlLiteral(false)).toBe("FALSE");
  });
  it("numeric wrapper -> bare number", () => {
    expect(sqlLiteral({ $numberInt: "5" })).toBe("5");
    expect(sqlLiteral({ $numberDouble: "3.14" })).toBe("3.14");
  });
  it("long/decimal outside float64's safe integer range keep their exact digit string", () => {
    expect(sqlLiteral({ $numberLong: "9223372036854775807" })).toBe("9223372036854775807");
    expect(sqlLiteral({ $numberDecimal: "123456789012345678901234.5" })).toBe("123456789012345678901234.5");
  });
  it("string -> quoted, embedded quotes escaped", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
  });
  it("objectId/date -> quoted display text", () => {
    expect(sqlLiteral({ $oid: "507f1f77bcf86cd799439011" })).toBe("'507f1f77bcf86cd799439011'");
  });
  it("object/array -> quoted JSON text", () => {
    expect(sqlLiteral({ a: 1 })).toBe("'{\"a\":1}'");
    expect(sqlLiteral([1, 2])).toBe("'[1,2]'");
  });
});

describe("toSql", () => {
  it("empty docs -> empty string", () => {
    expect(toSql([], "t")).toBe("");
  });
  it("creates a table with _id first and inserts one row per doc", () => {
    const docs = [
      { _id: { $oid: "a" }, name: "Ada", age: { $numberInt: "30" }, active: true },
    ];
    const sql = toSql(docs, "users");
    expect(sql).toContain('CREATE TABLE "users" (');
    expect(sql).toContain('"_id" TEXT');
    expect(sql).toContain('"name" TEXT');
    expect(sql).toContain('"age" INTEGER');
    expect(sql).toContain('"active" BOOLEAN');
    expect(sql).toContain('INSERT INTO "users" ("_id", "name", "age", "active") VALUES (\'a\', \'Ada\', 30, TRUE);');
  });
  it("mixed number/non-number values for one column fall back to TEXT", () => {
    const docs = [{ _id: 1, v: 5 }, { _id: 2, v: "x" }];
    const sql = toSql(docs, "t");
    expect(sql).toContain('"v" TEXT');
  });
  it("a column with only float values is REAL, only ints is INTEGER", () => {
    const floats = toSql([{ _id: 1, v: 1.5 }], "t");
    expect(floats).toContain('"v" REAL');
    const ints = toSql([{ _id: 1, v: { $numberInt: "5" } }], "t");
    expect(ints).toContain('"v" INTEGER');
  });
  it("nested object/array stays a single JSON-text column, not flattened", () => {
    const docs = [{ _id: 1, address: { city: "Hanoi" }, tags: ["a", "b"] }];
    const sql = toSql(docs, "t");
    expect(sql).toContain('"address" TEXT');
    expect(sql).toContain('"tags" TEXT');
    expect(sql).not.toContain('"address.city"');
    expect(sql).toContain("'{\"city\":\"Hanoi\"}'");
  });
});
