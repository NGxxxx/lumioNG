import { describe, it, expect } from "vitest";
import {
  applyUpdateDescription, toChangeEvent, KnownDocs, eventChanges, eventSummary, matchesFilter,
  trimEvents, documentPipeline, exportEvents, formatClock, CHANGE_OPS, type ChangeEvent,
} from "./changeEvents";

const int = (n: number) => ({ $numberInt: String(n) });
const ns = { db: "app", coll: "orders" };

function insert(id: number, doc: Record<string, unknown>) {
  return { operationType: "insert", ns, documentKey: { _id: int(id) }, fullDocument: { _id: int(id), ...doc } };
}
function update(id: number, updatedFields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    operationType: "update", ns, documentKey: { _id: int(id) },
    updateDescription: { updatedFields, removedFields: [], truncatedArrays: [] }, ...extra,
  };
}

describe("applyUpdateDescription", () => {
  it("sets dotted paths without mutating the input", () => {
    const before = { a: { b: int(1), c: int(2) }, list: [int(1), { q: int(1) }] };
    const out = applyUpdateDescription(before, {
      updatedFields: { "a.b": int(9), "list.1.q": int(5), "new.deep": true },
      removedFields: ["a.c"],
    });
    expect(out).toEqual({ a: { b: int(9) }, list: [int(1), { q: int(5) }], new: { deep: true } });
    expect(before.a.c).toEqual(int(2));
    expect(out.list).not.toBe(before.list);
  });

  it("truncates arrays before applying set fields", () => {
    const out = applyUpdateDescription({ xs: [1, 2, 3, 4] }, {
      truncatedArrays: [{ field: "xs", newSize: int(2) }],
      updatedFields: { "xs.1": 7 },
    });
    expect(out).toEqual({ xs: [1, 7] });
  });
});

describe("toChangeEvent", () => {
  it("tracks a document's state across insert → update → delete", () => {
    const known = new KnownDocs();
    const ins = toChangeEvent(insert(1, { status: "new", n: int(1) }), 1, 0, 10, known);
    expect(ins).toMatchObject({ op: "insert", ns: "app.orders", idText: '{"$numberInt":"1"}', before: null, beforeSource: "none" });

    // The looked-up fullDocument already shows a later write; the rebuilt state must not.
    const up = toChangeEvent(
      update(1, { status: "paid" }, { fullDocument: { _id: int(1), status: "shipped", n: int(1) } }),
      2, 0, 10, known,
    );
    expect(up.beforeSource).toBe("session");
    expect(up.before).toEqual({ _id: int(1), status: "new", n: int(1) });
    expect(up.after).toEqual({ _id: int(1), status: "paid", n: int(1) });
    expect(up.changed).toEqual(["status"]);
    expect(eventChanges(up)).toEqual([{ path: "status", kind: "changed", before: "new", after: "paid" }]);

    const del = toChangeEvent({ operationType: "delete", ns, documentKey: { _id: int(1) } }, 3, 0, 10, known);
    expect(del.before).toEqual(up.after);
    expect(del.after).toBeNull();
    expect(known.size).toBe(0);
  });

  it("prefers the server pre-image when present", () => {
    const known = new KnownDocs();
    const e = toChangeEvent(
      update(2, { n: int(3) }, { fullDocumentBeforeChange: { _id: int(2), n: int(2) } }), 1, 0, 1, known,
    );
    expect(e.beforeSource).toBe("preImage");
    expect(eventChanges(e)).toEqual([{ path: "n", kind: "changed", before: int(2), after: int(3) }]);
  });

  it("without a previous state, shows the new values and the looked-up document", () => {
    const e = toChangeEvent(
      update(3, { n: int(3) }, { fullDocument: { _id: int(3), n: int(3) } }), 1, 0, 1, new KnownDocs(),
    );
    expect(e.beforeSource).toBe("none");
    expect(e.after).toEqual({ _id: int(3), n: int(3) });
    expect(eventChanges(e)).toEqual([{ path: "n", kind: "changed", after: int(3) }]);
  });

  it("diffs a replace against the previous state", () => {
    const known = new KnownDocs();
    toChangeEvent(insert(4, { a: 1, b: 2 }), 1, 0, 1, known);
    const e = toChangeEvent(
      { operationType: "replace", ns, documentKey: { _id: int(4) }, fullDocument: { _id: int(4), a: 1, c: 3 } }, 2, 0, 1, known,
    );
    expect(e.changed).toEqual(["b", "c"]);
    expect(eventSummary(e)).toBe("b, c");
  });

  it("uses the server time, falling back to clusterTime then receive time", () => {
    const k = new KnownDocs();
    expect(toChangeEvent({ ...insert(5, {}), wallTime: { $date: { $numberLong: "1700000000123" } } }, 1, 9, 1, k).time).toBe(1700000000123);
    expect(toChangeEvent({ ...insert(6, {}), clusterTime: { $timestamp: { t: 1700000000, i: 1 } } }, 1, 9, 1, k).time).toBe(1700000000000);
    expect(toChangeEvent(insert(7, {}), 1, 9, 1, k).time).toBe(9);
  });

  it("maps collection-level events to 'other' with no document id", () => {
    const e = toChangeEvent({ operationType: "rename", ns, to: { db: "app", coll: "old_orders" } }, 1, 0, 1, new KnownDocs());
    expect(e).toMatchObject({ op: "other", opType: "rename", idText: null });
    expect(eventSummary(e)).toBe("→ app.old_orders");
  });
});

describe("KnownDocs", () => {
  it("evicts the least recently written document past its cap", () => {
    const k = new KnownDocs(2);
    k.set("a", {});
    k.set("b", {});
    k.set("a", { x: 1 });
    k.set("c", {});
    expect(k.get("b")).toBeUndefined();
    expect(k.get("a")).toEqual({ x: 1 });
  });
});

describe("filters and limits", () => {
  const known = new KnownDocs();
  const evs: ChangeEvent[] = [
    toChangeEvent(insert(1, { status: "a" }), 1, 0, 100, known),
    toChangeEvent(update(1, { "items.0.qty": int(2) }), 2, 0, 100, known),
    toChangeEvent({ operationType: "delete", ns, documentKey: { _id: int(1) } }, 3, 0, 100, known),
  ];

  it("filters by operation and by id / field text", () => {
    const all = new Set(CHANGE_OPS);
    expect(evs.filter((e) => matchesFilter(e, { ops: new Set(["update"]), text: "" })).map((e) => e.seq)).toEqual([2]);
    expect(evs.filter((e) => matchesFilter(e, { ops: all, text: "QTY" })).map((e) => e.seq)).toEqual([2]);
    expect(evs.filter((e) => matchesFilter(e, { ops: all, text: '"1"' })).length).toBe(3);
  });

  it("trims the oldest events by count and size, always keeping the newest", () => {
    expect(trimEvents(evs, 2, 1e9).map((e) => e.seq)).toEqual([2, 3]);
    expect(trimEvents(evs, 10, 250).map((e) => e.seq)).toEqual([2, 3]);
    expect(trimEvents(evs, 10, 50).map((e) => e.seq)).toEqual([3]);
    expect(trimEvents(evs, 10, 1e9)).toBe(evs);
  });

  it("builds a one-document pipeline and exports raw events", () => {
    expect(JSON.parse(documentPipeline('{"$oid":"65f0c0ffee0000000000abcd"}'))).toEqual([
      { $match: { "documentKey._id": { $oid: "65f0c0ffee0000000000abcd" } } },
    ]);
    expect(JSON.parse(exportEvents(evs))).toEqual(evs.map((e) => e.raw));
  });
});

describe("formatClock", () => {
  it("shows local time with milliseconds", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5, 6);
    expect(formatClock(d.getTime())).toBe("03:04:05.006");
  });
});
