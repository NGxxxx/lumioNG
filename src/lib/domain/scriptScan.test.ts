import { describe, it, expect } from "vitest";
import { scanDestructive } from "./scriptScan";

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
