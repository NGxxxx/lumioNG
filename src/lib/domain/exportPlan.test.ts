import { describe, it, expect } from "vitest";
import { targetKey, buildTargets, exportFileName, aggregateProgress, buildExportProjection, pickColumns, countLossyExportFields } from "./exportPlan";

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
  it("percent is null (indeterminate) when any row total is unknown", () => {
    expect(aggregateProgress([{ done: 5, total: 10 }, { done: 7, total: null }]))
      .toEqual({ done: 12, total: 10, percent: null });
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

describe("countLossyExportFields", () => {
  it("CSV counts only a selected array-typed leaf, not a scalar leaf under a dotted parent", () => {
    const cols = [
      { path: "_id", type: "objectId" as const },
      { path: "tags", type: "array" as const },
      { path: "address.city", type: "string" as const },
    ];
    expect(countLossyExportFields(cols, "csv")).toBe(1);
  });

  it("SQL counts a dotted leaf's top-level parent once, even with multiple leaves selected under it", () => {
    const cols = [
      { path: "address.city", type: "string" as const },
      { path: "address.zip", type: "int" as const },
    ];
    expect(countLossyExportFields(cols, "sql")).toBe(1);
  });

  it("SQL counts an undotted array-typed leaf as its own top-level field", () => {
    const cols = [{ path: "tags", type: "array" as const }];
    expect(countLossyExportFields(cols, "sql")).toBe(1);
  });

  it("CSV shows nothing lossy for the same dotted columns SQL flags (CSV flattens losslessly)", () => {
    const cols = [
      { path: "address.city", type: "string" as const },
      { path: "address.zip", type: "int" as const },
    ];
    expect(countLossyExportFields(cols, "csv")).toBe(0);
  });

  it("zero when nothing selected is lossy", () => {
    const cols = [{ path: "name", type: "string" as const }];
    expect(countLossyExportFields(cols, "csv")).toBe(0);
    expect(countLossyExportFields(cols, "sql")).toBe(0);
  });
});
