import { describe, it, expect } from "vitest";
import {
  toQueryEntry, speedOf, formatMillis, indexHint, querySummary, matchesQueryFilter, queryStatement, QUERY_KINDS,
} from "./profileEntries";

const int = (n: number) => ({ $numberInt: String(n) });
const ts = { $date: { $numberLong: "1792143371000" } };

// Shapes taken from MongoDB 7.0's system.profile.
const find = {
  op: "query", ns: "shop.orders", ts, millis: int(1450), planSummary: "COLLSCAN", appName: "api",
  command: { find: "orders", filter: { status: "paid" }, sort: { i: int(1) }, limit: int(3), $db: "shop", $readPreference: { mode: "primary" } },
  keysExamined: int(0), docsExamined: int(250000), nreturned: int(3),
};
const agg = {
  op: "command", ns: "shop.orders", ts, millis: int(12), planSummary: "IXSCAN { s: 1 }",
  command: { aggregate: "orders", pipeline: [{ $match: { s: "x" } }, { $group: { _id: "$s" } }], cursor: {} },
  docsExamined: int(50), nreturned: int(1),
};
const update = {
  op: "update", ns: "shop.orders", ts, millis: int(240),
  command: { q: { i: { $lt: int(5) } }, u: { $set: { s: "y" } }, multi: true, upsert: false },
  docsExamined: int(5000), nModified: int(5),
};
const remove = { op: "remove", ns: "shop.orders", ts, millis: int(1), command: { q: { _id: int(1) }, limit: int(1) }, ndeleted: int(1) };

describe("toQueryEntry", () => {
  it("reads name, kind, timing and counters, dropping driver plumbing", () => {
    const e = toQueryEntry(find, 1, 0, 100);
    expect(e).toMatchObject({
      name: "find", kind: "read", ns: "shop.orders", coll: "orders", millis: 1450, plan: "COLLSCAN", collscan: true,
      docsExamined: 250000, returned: 3, appName: "api", time: 1792143371000,
    });
    expect(e.command).toEqual({ find: "orders", filter: { status: "paid" }, sort: { i: int(1) }, limit: int(3) });
    expect(toQueryEntry(update, 2, 0, 1)).toMatchObject({ name: "update", kind: "write", affected: 5 });
    expect(toQueryEntry(remove, 3, 0, 1)).toMatchObject({ name: "delete", kind: "write", affected: 1 });
    expect(toQueryEntry({ op: "command", ns: "shop.$cmd", command: { ping: 1 } }, 4, 7, 1)).toMatchObject({ name: "ping", kind: "other", time: 7 });
  });
});

describe("speed and index hints", () => {
  it("grades durations", () => {
    expect([speedOf(5), speedOf(100), speedOf(999), speedOf(1000)]).toEqual(["fast", "medium", "medium", "slow"]);
    expect([formatMillis(0), formatMillis(340), formatMillis(1460), formatMillis(12_345)]).toEqual(["0 ms", "340 ms", "1.5 s", "12 s"]);
  });

  it("flags collection scans and reads far larger than the result", () => {
    expect(indexHint(toQueryEntry(find, 1, 0, 1))).toEqual({ kind: "collscan" });
    expect(indexHint(toQueryEntry(update, 1, 0, 1))).toEqual({ kind: "ratio", examined: 5000, returned: 5 });
    expect(indexHint(toQueryEntry(agg, 1, 0, 1))).toBeNull();
    // Small collections never warn.
    expect(indexHint(toQueryEntry({ ...find, docsExamined: int(20) }, 1, 0, 1))).toBeNull();
  });
});

describe("summary, filter and re-run statement", () => {
  const entries = [find, agg, update, remove].map((r, i) => toQueryEntry(r, i, 0, 1));

  it("summarizes what each query asked for", () => {
    expect(entries.map(querySummary)).toEqual([
      '{"status":"paid"}', "$match → $group", '{"i":{"$lt":{"$numberInt":"5"}}}', '{"_id":{"$numberInt":"1"}}',
    ]);
  });

  it("filters by kind, missing index and text", () => {
    const all = new Set(QUERY_KINDS);
    expect(entries.filter((e) => matchesQueryFilter(e, { kinds: new Set(["write"]), needsIndex: false, text: "" }))).toHaveLength(2);
    expect(entries.filter((e) => matchesQueryFilter(e, { kinds: all, needsIndex: true, text: "" })).map((e) => e.name)).toEqual(["find", "update"]);
    expect(entries.filter((e) => matchesQueryFilter(e, { kinds: all, needsIndex: false, text: "$group" })).map((e) => e.name)).toEqual(["aggregate"]);
  });

  it("rebuilds a runnable mongosh statement", () => {
    expect(queryStatement(entries[0])).toBe('db.getCollection("orders").find({"status":"paid"}).sort({"i":{"$numberInt":"1"}}).limit(3)');
    expect(queryStatement(entries[1])).toBe('db.getCollection("orders").aggregate([{"$match":{"s":"x"}},{"$group":{"_id":"$s"}}])');
    expect(queryStatement(entries[2])).toBe('db.getCollection("orders").updateMany({"i":{"$lt":{"$numberInt":"5"}}}, {"$set":{"s":"y"}})');
    expect(queryStatement(entries[3])).toBe('db.getCollection("orders").deleteOne({"_id":{"$numberInt":"1"}})');
    expect(queryStatement(toQueryEntry({ op: "getmore", ns: "a.b", command: { getMore: 1 } }, 1, 0, 1))).toBeNull();
  });
});
