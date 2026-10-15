import { describe, expect, it } from "vitest";
import { nextDelay, parseProfileEntry, parseSample, parseSlowOps, pushPoint, rates, type OpKind, type Point, type Sample } from "./serverMetrics";

const OPS0: Record<OpKind, number> = { insert: 0, query: 0, update: 0, delete: 0, getmore: 0, command: 0 };

function sample(over: Partial<Sample> = {}): Sample {
  return {
    at: 0,
    uptime: 500,
    opcounters: { ...OPS0 },
    connCurrent: 10,
    connAvailable: 90,
    netIn: 0,
    netOut: 0,
    memResidentMb: 100,
    host: "h:27017",
    version: "7.0.0",
    ...over,
  };
}

describe("parseSample", () => {
  it("reads canonical ExtJSON serverStatus subset", () => {
    const text = JSON.stringify({
      host: "db1:27017",
      version: "7.0.2",
      uptime: { $numberDouble: "1234.0" },
      opcounters: {
        insert: { $numberLong: "1" },
        query: { $numberLong: "2" },
        update: { $numberLong: "3" },
        delete: { $numberLong: "4" },
        getmore: { $numberLong: "5" },
        command: { $numberLong: "6" },
      },
      connections: { current: { $numberInt: "38" }, available: { $numberInt: "800" } },
      network: { bytesIn: { $numberLong: "1000" }, bytesOut: { $numberLong: "2000" } },
      mem: { resident: { $numberInt: "512" } },
    });
    expect(parseSample(text, 42)).toEqual({
      at: 42,
      uptime: 1234,
      opcounters: { insert: 1, query: 2, update: 3, delete: 4, getmore: 5, command: 6 },
      connCurrent: 38,
      connAvailable: 800,
      netIn: 1000,
      netOut: 2000,
      memResidentMb: 512,
      host: "db1:27017",
      version: "7.0.2",
    });
  });

  it("missing mem/host/version → null fields", () => {
    const s = parseSample(JSON.stringify({ uptime: 5, opcounters: {} }), 1);
    expect(s).not.toBeNull();
    expect(s!.memResidentMb).toBeNull();
    expect(s!.host).toBeNull();
    expect(s!.version).toBeNull();
    expect(s!.opcounters).toEqual(OPS0);
  });

  it("invalid JSON, non-object, or no uptime → null", () => {
    expect(parseSample("not json", 0)).toBeNull();
    expect(parseSample("[1,2]", 0)).toBeNull();
    expect(parseSample("{}", 0)).toBeNull();
  });
});

describe("rates", () => {
  it("per-second deltas", () => {
    const prev = sample({ at: 1000, opcounters: { ...OPS0, query: 100, insert: 10 }, netIn: 0, netOut: 100 });
    const next = sample({ at: 3000, uptime: 502, opcounters: { ...OPS0, query: 300, insert: 30 }, netIn: 4000, netOut: 300 });
    const r = rates(prev, next)!;
    expect(r.byKind.query).toBe(100);
    expect(r.byKind.insert).toBe(10);
    expect(r.ops).toBe(110);
    expect(r.netInPerSec).toBe(2000);
    expect(r.netOutPerSec).toBe(100);
  });

  it("rates returns null on reset", () => {
    const prev = sample({ at: 0, uptime: 500 });
    const next = sample({ at: 2000, uptime: 3 });
    expect(rates(prev, next)).toBeNull();
  });

  it("returns null when any counter decreases", () => {
    expect(rates(sample({ at: 0, opcounters: { ...OPS0, command: 5 } }), sample({ at: 2000, opcounters: { ...OPS0, command: 4 } }))).toBeNull();
    expect(rates(sample({ at: 0, netIn: 10 }), sample({ at: 2000, netIn: 5 }))).toBeNull();
  });

  it("returns null when dt <= 0", () => {
    expect(rates(sample({ at: 1000 }), sample({ at: 1000 }))).toBeNull();
    expect(rates(sample({ at: 2000 }), sample({ at: 1000 }))).toBeNull();
  });
});

describe("pushPoint", () => {
  it("caps at 60, dropping the oldest", () => {
    let s: Point[] = [];
    for (let i = 0; i < 61; i++) s = pushPoint(s, { at: i, v: i });
    expect(s).toHaveLength(60);
    expect(s[0]).toEqual({ at: 1, v: 1 });
    expect(s[59]).toEqual({ at: 60, v: 60 });
  });

  it("keeps null as a gap and does not mutate input", () => {
    const input: Point[] = [{ at: 1, v: 1 }];
    const out = pushPoint(input, null);
    expect(out).toEqual([{ at: 1, v: 1 }, null]);
    expect(input).toEqual([{ at: 1, v: 1 }]);
    expect(out).not.toBe(input);
  });

  it("honours a custom cap", () => {
    expect(pushPoint([{ at: 1, v: 1 }, { at: 2, v: 2 }], { at: 3, v: 3 }, 2)).toEqual([{ at: 2, v: 2 }, { at: 3, v: 3 }]);
  });
});

describe("nextDelay", () => {
  it("is max(interval, 1.5 × lastTick)", () => {
    expect(nextDelay(2000, 500)).toBe(2000);
    expect(nextDelay(2000, 3000)).toBe(4500);
  });
});

describe("parseSlowOps", () => {
  it("excludes own app, sorts by secs desc, unwraps ExtJSON", () => {
    const texts = [
      JSON.stringify({ opid: 1, op: "query", ns: "a.b", secs_running: { $numberLong: "5" }, client: "1.2.3.4:5", appName: "mongosh" }),
      JSON.stringify({ opid: { $numberInt: "2" }, op: "update", ns: "a.c", secs_running: 30, client_s: "9.9.9.9:1", appName: "x" }),
      JSON.stringify({ opid: 3, op: "command", ns: "a.d", secs_running: 1, client: "c", appName: "Own" }),
      JSON.stringify({ opid: { $numberLong: "4" }, op: "getmore", ns: "a.e", secs_running: 1 }),
    ];
    const ops = parseSlowOps(texts, "Own");
    expect(ops.map((o) => o.opid)).toEqual([2, 1, 4]);
    expect(ops[0]).toEqual({ opid: 2, op: "update", ns: "a.c", secs: 30, client: "9.9.9.9:1", appName: "x" });
    expect(ops[2]).toEqual({ opid: 4, op: "getmore", ns: "a.e", secs: 1, client: "", appName: "" });
  });

  it("skips unparseable entries and entries without an opid; keeps mongos string opids", () => {
    expect(parseSlowOps(["nope", JSON.stringify({ secs_running: 3 })], "Own")).toEqual([]);
    expect(parseSlowOps([JSON.stringify({ opid: "shard01:1234", secs_running: 3 })], "Own").map((o) => o.opid)).toEqual(["shard01:1234"]);
  });
});

describe("parseProfileEntry", () => {
  it("reads ts (canonical or relaxed), op, ns, millis, planSummary", () => {
    expect(parseProfileEntry(JSON.stringify({
      ts: { $date: { $numberLong: "1700000000000" } }, op: "query", ns: "shop.orders",
      millis: { $numberInt: "812" }, planSummary: "COLLSCAN",
    }))).toEqual({ ts: 1700000000000, op: "query", ns: "shop.orders", millis: 812, plan: "COLLSCAN" });
    expect(parseProfileEntry(JSON.stringify({ ts: { $date: "2026-01-01T00:00:00Z" } }))).toEqual({
      ts: Date.parse("2026-01-01T00:00:00Z"), op: "", ns: "", millis: 0, plan: "",
    });
  });
  it("null for invalid input", () => {
    expect(parseProfileEntry("nope")).toBeNull();
    expect(parseProfileEntry("[1]")).toBeNull();
  });
});
