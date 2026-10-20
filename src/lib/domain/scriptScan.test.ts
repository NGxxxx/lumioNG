import { describe, it, expect } from "vitest";
import { scanDestructive, scanCritical, withLoadedSnippets } from "./scriptScan";

describe("scanDestructive", () => {
  it("flags update/delete/replace/remove/drop family", () => {
    const ops = scanDestructive(
      "db.c.updateOne({},{}); db.c.deleteMany({}); db.c.replaceOne({},{}); db.c.remove({}); db.c.drop(); db.c.dropIndex('i'); db.dropDatabase(); db.c.bulkWrite([]); db.c.findOneAndDelete({}); db.c.findAndModify({});"
    );
    expect(ops).toEqual(
      expect.arrayContaining([
        "updateOne", "deleteMany", "replaceOne", "remove", "drop",
        "dropIndex", "dropDatabase", "bulkWrite", "findOneAndDelete", "findAndModify",
      ]),
    );
  });

  it("does NOT flag pure inserts or reads", () => {
    expect(scanDestructive("db.c.insertOne({a:1}); db.c.find({}); db.c.aggregate([]); db.c.countDocuments({});")).toEqual([]);
  });

  it("dedupes repeated ops", () => {
    expect(scanDestructive("db.a.deleteOne({}); db.b.deleteOne({});")).toEqual(["deleteOne"]);
  });

  it("ignores matches inside line and block comments (best-effort)", () => {
    expect(scanDestructive("// db.c.drop()\n/* db.c.deleteMany({}) */ db.c.find({})")).toEqual([]);
  });
});

describe("scanCritical", () => {
  it("flags dropDatabase/drop/dropIndex/dropIndexes regardless of arguments", () => {
    expect(scanCritical("db.dropDatabase();")).toEqual(["dropDatabase"]);
    expect(scanCritical("db.c.drop();")).toEqual(["drop"]);
    expect(scanCritical("db.c.dropIndex('a_1');")).toEqual(["dropIndex"]);
    expect(scanCritical("db.c.dropIndexes();")).toEqual(["dropIndexes"]);
  });

  it("flags deleteMany/updateMany/remove only with a literal empty filter", () => {
    expect(scanCritical("db.c.deleteMany({});")).toEqual(["deleteMany"]);
    expect(scanCritical("db.c.deleteMany();")).toEqual(["deleteMany"]);
    expect(scanCritical("db.c.updateMany({}, {$set:{a:1}});")).toEqual(["updateMany"]);
    expect(scanCritical("db.c.remove({});")).toEqual(["remove"]);
  });

  it("does NOT flag deleteMany/updateMany/remove with a real filter", () => {
    expect(scanCritical("db.c.deleteMany({status:'old'});")).toEqual([]);
    expect(scanCritical("db.c.updateMany({a:1}, {$set:{b:2}});")).toEqual([]);
  });

  it("does not flag a filter stored in a variable (best-effort, falls through to the warn tier)", () => {
    expect(scanCritical("var f = {}; db.c.deleteMany(f);")).toEqual([]);
  });

  it("does NOT flag deleteOne/updateOne (single-doc ops stay warn-tier)", () => {
    expect(scanCritical("db.c.deleteOne({}); db.c.updateOne({}, {$set:{a:1}});")).toEqual([]);
  });

  it("dedupes and ignores comments (best-effort)", () => {
    expect(scanCritical("db.c.drop(); db.d.drop(); // db.dropDatabase()")).toEqual(["drop"]);
  });
});

describe("withLoadedSnippets", () => {
  const lib: Record<string, string> = {
    wipe: `db.logs.deleteMany({})`,
    outer: `load("wipe")`,
    loop: `load("loop")`,
    safe: `db.logs.find()`,
  };
  const lookup = (n: string) => lib[n];

  it("appends the source of snippets the script loads, so the destructive scan sees them", () => {
    const { text, unresolved } = withLoadedSnippets(`load("outer")`, lookup);
    expect(unresolved).toBe(false);
    expect(scanDestructive(text)).toEqual(["deleteMany"]);
    expect(scanCritical(text)).toContain("deleteMany");
  });

  it("reads backtick literals without interpolation", () => {
    const { text, unresolved } = withLoadedSnippets("load(`wipe`)", lookup);
    expect(unresolved).toBe(false);
    expect(scanDestructive(text)).toEqual(["deleteMany"]);
  });

  it("is quiet for plain scripts, resolved safe loads and commented-out loads", () => {
    expect(withLoadedSnippets(`db.c.find()`, lookup).unresolved).toBe(false);
    expect(withLoadedSnippets(`load("safe")`, lookup).unresolved).toBe(false);
    expect(withLoadedSnippets(`// load(n)\n/* load("x") */ db.c.find()`, lookup).unresolved).toBe(false);
    expect(withLoadedSnippets(`db.payload.find()`, lookup).unresolved).toBe(false);
    expect(withLoadedSnippets(`globalThis.load("safe")`, lookup).unresolved).toBe(false); // still a literal, still scanned
  });

  it("fails closed on loads it cannot resolve", () => {
    for (const script of [
      `var n = "wipe"; load(n)`,
      `load("wi" + "pe")`,
      "load(`w${'ipe'}`)",
      `var l = load; l("wipe")`,
      `globalThis.load(n)`,
      `this["load"]("wipe")`,
      `load("missing")`,
      `load("wipe", 1)`,
    ]) {
      expect(withLoadedSnippets(script, lookup).unresolved, script).toBe(true);
    }
  });

  it("fails closed when a loaded snippet itself loads dynamically", () => {
    expect(withLoadedSnippets(`load("dyn")`, (n) => (n === "dyn" ? `load(x)` : undefined)).unresolved).toBe(true);
  });

  it("is unresolved when the library is unavailable (nothing can be looked up)", () => {
    expect(withLoadedSnippets(`load("wipe")`, () => undefined).unresolved).toBe(true);
  });

  it("stops at the depth cap on cycles", () => {
    expect(() => withLoadedSnippets(`load("loop")`, lookup)).not.toThrow();
  });
});
