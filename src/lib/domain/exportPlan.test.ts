import { describe, it, expect } from "vitest";
import { targetKey, buildTargets, exportFileName, aggregateProgress, buildExportProjection, pickColumns } from "./exportPlan";

describe("buildTargets", () => {
  const dbs = [
    { name: "shop", collections: ["users", "orders"] },
    { name: "logs", collections: ["events"] },
  ];
  it("returns checked targets in tree order", () => {
    const checked = new Set([targetKey("shop", "orders"), targetKey("logs", "events")]);
    expect(buildTargets(dbs, checked)).toEqual([
      { db: "shop", coll: "orders" },
      { db: "logs", coll: "events" },
    ]);
  });
  it("empty when nothing checked", () => {
    expect(buildTargets(dbs, new Set())).toEqual([]);
  });
});

describe("exportFileName", () => {
  it("joins db.coll.ext", () => {
    expect(exportFileName("shop", "users", "json")).toBe("shop.users.json");
  });
});

describe("aggregateProgress", () => {
  it("sums done/total and computes percent", () => {
    expect(aggregateProgress([{ done: 5, total: 10 }, { done: 5, total: 10 }]))
      .toEqual({ done: 10, total: 20, percent: 50 });
  });
  it("percent 0 when total is 0", () => {
    expect(aggregateProgress([{ done: 0, total: 0 }])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("buildExportProjection", () => {
  it("excludes unchecked columns", () => {
    expect(buildExportProjection(["_id", "a", "b"], ["_id", "a"])).toBe('{"b":0}');
  });
  it("drops _id when unchecked", () => {
    expect(buildExportProjection(["_id", "a"], ["a"])).toBe('{"_id":0}');
  });
  it("null when everything selected", () => {
    expect(buildExportProjection(["_id", "a"], ["_id", "a"])).toBeNull();
  });
});

describe("pickColumns", () => {
  it("keeps only selected paths, re-nesting", () => {
    const docs = [{ _id: 1, a: { b: 2, c: 3 }, d: 4 }];
    expect(pickColumns(docs, ["_id", "a.b"])).toEqual([{ _id: 1, a: { b: 2 } }]);
  });
  it("skips missing fields", () => {
    expect(pickColumns([{ _id: 1 }], ["_id", "x"])).toEqual([{ _id: 1 }]);
  });
  it("keeps two sibling nested paths under the same parent", () => {
    expect(pickColumns([{ a: { b: 1, c: 2, d: 3 } }], ["a.b", "a.c"])).toEqual([{ a: { b: 1, c: 2 } }]);
  });
});
