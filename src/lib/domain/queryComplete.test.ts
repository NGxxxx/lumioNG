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

  it("detects an expression operator in a bare value position", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": $su| } }])');
    expect(contextAt(text, pos).kind).toBe("exprOp"); // after ':' → value position, $-prefixed, bare
  });

  it("offers method completion when the cursor is inside the method name", () => {
    const { text, pos } = at("db.c.aggreg|ate([])");
    expect(contextAt(text, pos).kind).toBe("method");
  });

  it("ignores braces inside strings", () => {
    const { text, pos } = at('db.c.aggregate([{ "$match": { "label": "a{b}c", "ye|" } }])');
    expect(contextAt(text, pos).kind).toBe("field");
  });
});

describe("needsFields", () => {
  it("is true for field and fieldRef", () => {
    expect(needsFields("field")).toBe(true);
    expect(needsFields("fieldRef")).toBe(true);
    expect(needsFields("stage")).toBe(false);
    expect(needsFields("collection")).toBe(false);
    expect(needsFields("method")).toBe(false);
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

  it("suggests expression operators in a bare value position", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": $su| } }])');
    const r = completeAt(text, pos, { collections: [], fields: ["name"] });
    expect(r!.kind).toBe("exprOp");
    expect(r!.options.map((o) => o.label)).toContain("$sum"); // EXPR_OPERATORS, not fields
    expect(r!.options.every((o) => o.label.startsWith("$"))).toBe(true);
  });

  it("returns null when the context is valid but nothing matches the prefix", () => {
    const { text, pos } = at('db.c.aggregate([{ "$zzz|" }])');
    expect(completeAt(text, pos, { collections: [], fields: [] })).toBeNull();
  });

  it("suggests methods when completing inside a method name", () => {
    const { text, pos } = at("db.c.aggreg|ate([])");
    const r = completeAt(text, pos, { collections: [], fields: [] });
    expect(r!.kind).toBe("method");
    expect(r!.options.map((o) => o.label)).toContain("aggregate");
  });

  it("tolerates an unparseable statement without throwing", () => {
    const { text, pos } = at("not a statement |");
    expect(() => completeAt(text, pos, { collections: [], fields: [] })).not.toThrow();
  });
});

describe("method + generalized contexts", () => {
  it("detects method context after db.<coll>.", () => {
    const { text, pos } = at("db.users.fi|");
    const c = contextAt(text, pos);
    expect(c.kind).toBe("method");
    expect(c.prefix).toBe("fi");
  });
  it("detects method context after getCollection(\"x\").", () => {
    const { text, pos } = at('db.getCollection("users").up|');
    expect(contextAt(text, pos).kind).toBe("method");
  });
  it("offers getCollection alongside collections after db.", () => {
    const { text, pos } = at("db.|");
    const r = completeAt(text, pos, { collections: ["users", "orders"], fields: [] });
    expect(r!.kind).toBe("collection");
    expect(r!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["users", "orders", "getCollection"]));
  });
  it("does NOT offer getCollection inside getCollection(\"…", () => {
    const { text, pos } = at('db.getCollection("us|")');
    const r = completeAt(text, pos, { collections: ["users"], fields: [] });
    expect(r!.options.map((o) => o.label)).not.toContain("getCollection");
  });
  it("suggests methods after db.<coll>.", () => {
    const { text, pos } = at("db.c.de|");
    const r = completeAt(text, pos, { collections: [], fields: [] });
    expect(r!.kind).toBe("method");
    expect(r!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["deleteOne", "deleteMany"]));
  });
  it("treats a find filter key as a field, not a stage", () => {
    const { text, pos } = at('db.c.find({ "ye|" })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
  it("treats a countDocuments filter key as a field", () => {
    const { text, pos } = at('db.c.countDocuments({ "ye|" })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
  it("treats a projection key as a field", () => {
    const { text, pos } = at('db.c.find({}, { "ye|" })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
  it("treats a .sort key as a field (chained call)", () => {
    const { text, pos } = at('db.c.find({}).sort({ "ye|" })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
  it("treats an update $set key as a field", () => {
    const { text, pos } = at('db.c.updateOne({}, { "$set": { "ye|" } })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
  it("still detects a stage only inside the aggregate pipeline array", () => {
    const { text, pos } = at('db.c.aggregate([{ "$ma|" }])');
    expect(contextAt(text, pos).kind).toBe("stage");
  });
});

describe("cursor methods", () => {
  it("detects cursor context right after find()", () => {
    const { text, pos } = at("db.c.find().|");
    const c = contextAt(text, pos);
    expect(c.kind).toBe("cursor");
  });
  it("detects cursor context after a non-empty find(filter)", () => {
    const { text, pos } = at('db.c.find({ "a": 1 }).so|');
    const c = contextAt(text, pos);
    expect(c.kind).toBe("cursor");
    expect(c.prefix).toBe("so");
  });
  it("detects cursor context after aggregate([])", () => {
    const { text, pos } = at("db.c.aggregate([]).|");
    expect(contextAt(text, pos).kind).toBe("cursor");
  });
  it("detects cursor context after a chained cursor method", () => {
    const { text, pos } = at("db.c.find().sort({}).|");
    expect(contextAt(text, pos).kind).toBe("cursor");
  });
  it("does NOT offer cursor methods after a write call", () => {
    const { text, pos } = at("db.c.insertOne({}).|");
    expect(contextAt(text, pos).kind).not.toBe("cursor");
  });
  it("suggests cursor methods filtered by prefix", () => {
    const { text, pos } = at("db.c.find().s|");
    const r = completeAt(text, pos, { collections: [], fields: [] });
    expect(r!.kind).toBe("cursor");
    expect(r!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["sort", "skip"]));
    expect(r!.options.every((o) => o.label.startsWith("s"))).toBe(true);
  });
});

describe("db-level methods", () => {
  it("offers db methods alongside collections after db.", () => {
    const { text, pos } = at("db.run|");
    const r = completeAt(text, pos, { collections: ["runners"], fields: [] });
    expect(r!.kind).toBe("collection");
    expect(r!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["runCommand", "runners"]));
  });
  it("does NOT offer db methods inside getCollection(\"…", () => {
    const { text, pos } = at('db.getCollection("ru|")');
    const r = completeAt(text, pos, { collections: ["runners"], fields: [] });
    expect(r!.options.map((o) => o.label)).not.toContain("runCommand");
  });
});

describe("multi-statement documents", () => {
  it("classifies the statement the cursor is in, not the first one", () => {
    const { text, pos } = at('db.a.find({})\ndb.b.aggregate([{ "$ma|" }])');
    expect(contextAt(text, pos).kind).toBe("stage");
  });
  it("a find filter in the second statement is a field, not a stage", () => {
    const { text, pos } = at('db.a.aggregate([{}])\ndb.b.find({ "ye|" })');
    expect(contextAt(text, pos).kind).toBe("field");
  });
});

describe("field references inside value strings", () => {
  it("classifies a $-string in a value position as fieldRef", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "_id": "$st|" } }])');
    const c = contextAt(text, pos);
    expect(c.kind).toBe("fieldRef");
    expect(c.prefix).toBe("$st");
  });
  it("suggests field names prefixed with $ for a fieldRef", () => {
    const { text, pos } = at('db.c.aggregate([{ "$group": { "n": { "$sum": "$am|" } } }])');
    const r = completeAt(text, pos, { collections: [], fields: ["amount", "amends", "name"] });
    expect(r!.kind).toBe("fieldRef");
    expect(r!.options.map((o) => o.label)).toEqual(["$amount", "$amends"]);
  });
  it("a non-$ string value is not completable (none)", () => {
    const { text, pos } = at('db.c.find({ "status": "ac|" })');
    expect(contextAt(text, pos).kind).toBe("none");
  });
});
