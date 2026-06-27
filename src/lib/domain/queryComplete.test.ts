import { describe, it, expect } from "vitest";
import { contextAt, needsFields, completeAt } from "./queryComplete";

// Helper: build text + cursor from a string containing a single "|" marker.
function at(s: string): { text: string; pos: number } {
  const pos = s.indexOf("|");
  return { text: s.slice(0, pos) + s.slice(pos + 1), pos };
}

describe("contextAt", () => {
  it("detects collection after db.", () => {
    const { text, pos } = at("db.or|");
    const c = contextAt(text, pos);
    expect(c.kind).toBe("collection");
    expect(c.prefix).toBe("or");
    expect(text.slice(c.from, pos)).toBe("or");
  });

  it("detects collection inside getCollection(\"…", () => {
    const { text, pos } = at('db.getCollection("mov|").aggregate([])');
    expect(contextAt(text, pos).kind).toBe("collection");
    expect(contextAt(text, pos).prefix).toBe("mov");
  });

  it("detects a stage at the first key of a pipeline object", () => {
    const { text, pos } = at('db.c.aggregate([{ "$ma|" }])');
    const c = contextAt(text, pos);
    expect(c.kind).toBe("stage");
    expect(c.prefix).toBe("$ma");
  });

  it("detects a field inside a $match condition object", () => {
    const { text, pos } = at('db.c.aggregate([{ "$match": { "ye|" } }])');
    expect(contextAt(text, pos).kind).toBe("field");
  });

  it("treats a nested object key as a field (offers fields + query operators)", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": "$x", "t": { "$su|" } } }])');
    expect(contextAt(text, pos).kind).toBe("field"); // key position of nested object → field
  });

  it("detects an expression operator in a value position", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": "$su|" } }])');
    expect(contextAt(text, pos).kind).toBe("exprOp"); // after ':' → value position, $-prefixed
  });

  it("returns none before the pipeline", () => {
    const { text, pos } = at("db.c.aggreg|ate([])");
    expect(contextAt(text, pos).kind).toBe("none");
  });

  it("ignores braces inside strings", () => {
    const { text, pos } = at('db.c.aggregate([{ "$match": { "label": "a{b}c", "ye|" } }])');
    expect(contextAt(text, pos).kind).toBe("field");
  });
});

describe("needsFields", () => {
  it("is true only for the field kind", () => {
    expect(needsFields("field")).toBe(true);
    expect(needsFields("stage")).toBe(false);
    expect(needsFields("collection")).toBe(false);
    expect(needsFields("none")).toBe(false);
    expect(needsFields("exprOp")).toBe(false);
  });
});

describe("completeAt", () => {
  it("suggests matching collections", () => {
    const { text, pos } = at("db.or|");
    const r = completeAt(text, pos, { collections: ["orders", "order_items", "users"], fields: [] });
    expect(r).not.toBeNull();
    expect(r!.options.map((o) => o.label)).toEqual(["orders", "order_items"]);
    expect(r!.from).toBe(pos - 2);
  });

  it("suggests matching pipeline stages", () => {
    const { text, pos } = at('db.c.aggregate([{ "$ma|" }])');
    const r = completeAt(text, pos, { collections: [], fields: [] });
    expect(r!.options.map((o) => o.label)).toContain("$match");
    expect(r!.options.every((o) => o.label.startsWith("$ma"))).toBe(true);
  });

  it("merges fields and query operators in a field context, disambiguated by prefix", () => {
    const fields = ["year", "yellow", "name"];
    const plain = at('db.c.aggregate([{ "$match": { "ye|" } }])');
    const rp = completeAt(plain.text, plain.pos, { collections: [], fields });
    expect(rp!.options.map((o) => o.label)).toEqual(["year", "yellow"]); // operators don't match "ye"

    const dollar = at('db.c.aggregate([{ "$match": { "$o|" } }])');
    const rd = completeAt(dollar.text, dollar.pos, { collections: [], fields });
    expect(rd!.options.map((o) => o.label)).toContain("$or"); // fields don't start with "$"
    expect(rd!.options.every((o) => o.label.startsWith("$o"))).toBe(true);
  });

  it("suggests expression operators in a value position", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": "$su|" } }])');
    const r = completeAt(text, pos, { collections: [], fields: ["name"] });
    expect(r!.options.map((o) => o.label)).toContain("$sum"); // EXPR_OPERATORS, not fields
    expect(r!.options.every((o) => o.label.startsWith("$"))).toBe(true);
  });

  it("returns null when the context is valid but nothing matches the prefix", () => {
    const { text, pos } = at('db.c.aggregate([{ "$zzz|" }])');
    expect(completeAt(text, pos, { collections: [], fields: [] })).toBeNull();
  });

  it("returns null in a none context", () => {
    const { text, pos } = at("db.c.aggreg|ate([])");
    expect(completeAt(text, pos, { collections: [], fields: [] })).toBeNull();
  });

  it("tolerates an unparseable statement without throwing", () => {
    const { text, pos } = at("not a statement |");
    expect(() => completeAt(text, pos, { collections: [], fields: [] })).not.toThrow();
  });
});
