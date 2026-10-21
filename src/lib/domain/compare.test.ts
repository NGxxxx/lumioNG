import { describe, it, expect } from "vitest";
import { parseFieldList, syncEnds, planKey, sameNamespace, plannedTotal, rowChanges, formatKey, type SyncPlan, type SyncReport } from "./compare";

const plan = (over: Partial<SyncPlan> = {}): SyncPlan => ({
  src: { sessionId: "a", db: "shop", coll: "orders" },
  dst: { sessionId: "b", db: "shop", coll: "orders" },
  key: "_id",
  filter: null,
  ignoreFields: ["updatedAt"],
  insertMissing: true,
  replaceDifferent: true,
  deleteExtra: false,
  direction: "srcToDst",
  ...over,
});

describe("compare domain", () => {
  it("parses the ignored-field list", () => {
    expect(parseFieldList(" updatedAt, meta.seen\n\n_v ,")).toEqual(["updatedAt", "meta.seen", "_v"]);
    expect(parseFieldList("")).toEqual([]);
  });

  it("direction decides which side is written", () => {
    const p = plan();
    expect(syncEnds(p)).toEqual({ from: p.src, to: p.dst });
    const r = plan({ direction: "dstToSrc" });
    expect(syncEnds(r)).toEqual({ from: r.dst, to: r.src });
  });

  it("plan key changes with anything that changes the writes, not with field-list order", () => {
    const k = planKey(plan());
    expect(planKey(plan({ ignoreFields: ["updatedAt", " "] }))).toBe(k);
    expect(planKey(plan({ direction: "dstToSrc" }))).not.toBe(k);
    expect(planKey(plan({ deleteExtra: true }))).not.toBe(k);
    expect(planKey(plan({ filter: "{\"a\":1}" }))).not.toBe(k);
    expect(planKey(plan({ dst: { sessionId: "c", db: "shop", coll: "orders" } }))).not.toBe(k);
    expect(planKey(plan({ ignoreFields: ["b", "a"] }))).toBe(planKey(plan({ ignoreFields: ["a", "b"] })));
  });

  it("detects the same namespace", () => {
    expect(sameNamespace(plan().src, { ...plan().src })).toBe(true);
    expect(sameNamespace(plan().src, plan().dst)).toBe(false);
  });

  it("sums planned writes", () => {
    const r = { planned: { insert: 2, replace: 3, delete: 4 } } as SyncReport;
    expect(plannedTotal(r)).toBe(9);
  });

  it("field changes of a differing row reuse docDiff", () => {
    const changes = rowChanges({ src: { _id: 1, a: 1, b: 2 }, dst: { b: 2, _id: 1, a: 5, c: 1 } });
    expect(changes.map((c) => [c.path, c.kind])).toEqual([["a", "changed"], ["c", "removed"]]);
    expect(rowChanges({ src: { _id: 1 }, dst: null })).toEqual([]);
  });

  it("formats key values compactly", () => {
    expect(formatKey({ $oid: "65a000000000000000000001" })).toBe("65a000000000000000000001");
    expect(formatKey({ $numberInt: "7" })).toBe("7");
    expect(formatKey("abc")).toBe("\"abc\"");
  });
});
