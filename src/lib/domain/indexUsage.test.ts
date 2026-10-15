import { describe, it, expect } from "vitest";
import type { IndexInfo } from "./indexes";
import {
  parseServerTraits,
  parseShardKey,
  parseIndexStats,
  classify,
  redundantWith,
  dataDays,
  buildIndexRows,
  unusedSummary,
  LOW_CONFIDENCE_DAYS,
  type IndexUsage,
} from "./indexUsage";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 15);

function idx(name: string, entries: [string, number | string][], extra: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name,
    entries: entries.map(([field, value]) => ({ field, value })),
    unique: false,
    sparse: false,
    ttl: null,
    isId: name === "_id_",
    hidden: false,
    partial: false,
    collation: null,
    ...extra,
  };
}

function use(name: string, ops: number, daysAgo = 10): IndexUsage {
  return { name, ops, since: NOW - daysAgo * DAY };
}

function statText(name: string, ops: string, since: unknown, shard?: string): string {
  return JSON.stringify({
    name,
    key: { a: { $numberInt: "1" } },
    host: "h:27017",
    ...(shard ? { shard } : {}),
    accesses: { ops: { $numberLong: ops }, since },
  });
}

describe("parseIndexStats", () => {
  it("parses canonical entries", () => {
    const since = NOW - 5 * DAY;
    const r = parseIndexStats([statText("a_1", "42", { $date: { $numberLong: String(since) } })]);
    expect(r).toEqual([{ name: "a_1", ops: 42, since }]);
  });

  it("accepts relaxed ISO $date", () => {
    const r = parseIndexStats([statText("a_1", "1", { $date: "2026-10-10T00:00:00Z" })]);
    expect(r[0].since).toBe(Date.parse("2026-10-10T00:00:00Z"));
  });

  it("sums two shards and takes the later since", () => {
    const early = NOW - 9 * DAY;
    const late = NOW - 2 * DAY;
    const r = parseIndexStats([
      statText("a_1", "3", { $date: { $numberLong: String(early) } }, "s0"),
      statText("a_1", "4", { $date: { $numberLong: String(late) } }, "s1"),
      statText("_id_", "1", { $date: { $numberLong: String(early) } }, "s0"),
    ]);
    expect(r).toEqual([
      { name: "a_1", ops: 7, since: late },
      { name: "_id_", ops: 1, since: early },
    ]);
  });
});

describe("classify", () => {
  it("protected indexes are never unused", () => {
    expect(classify(idx("_id_", [["_id", 1]]), use("_id_", 0), 1e9, 1, NOW)).toBe("protectedId");
    expect(classify(idx("e_1", [["e", 1]], { unique: true }), use("e_1", 0), 1e9, 1, NOW)).toBe(
      "protectedUnique",
    );
    expect(classify(idx("t_1", [["t", 1]], { ttl: 3600 }), use("t_1", 0), 1e9, 1, NOW)).toBe(
      "protectedTtl",
    );
    expect(
      classify(idx("r_1_x_1", [["r", 1], ["x", 1]]), use("r_1_x_1", 0), 1e9, 1, NOW, ["r"]),
    ).toBe("protectedShardKey");
  });

  it("shard key must be a prefix in order", () => {
    const i = idx("x_1_r_1", [["x", 1], ["r", 1]]);
    expect(classify(i, use(i.name, 0), 10, 1, NOW, ["r"])).toBe("unused");
    expect(classify(i, use(i.name, 0), 10, 1, NOW, ["x", "r"])).toBe("protectedShardKey");
    expect(classify(i, use(i.name, 0), 10, 1, NOW, [])).toBe("unused");
    expect(classify(i, use(i.name, 0), 10, 1, NOW, null)).toBe("unused");
  });

  it("unused when 0 ops", () => {
    expect(classify(idx("a_1", [["a", 1]]), use("a_1", 0), 10, 100, NOW)).toBe("unused");
  });

  it("rare: 2 ops over 10 days and size > mean", () => {
    expect(classify(idx("a_1", [["a", 1]]), use("a_1", 2, 10), 500, 100, NOW)).toBe("rare");
  });

  it("not rare when size <= mean", () => {
    expect(classify(idx("a_1", [["a", 1]]), use("a_1", 2, 10), 100, 100, NOW)).toBe("inUse");
  });

  it("inUse with >= 1 op/day", () => {
    expect(classify(idx("a_1", [["a", 1]]), use("a_1", 50, 10), 500, 100, NOW)).toBe("inUse");
  });

  it("days is at least 1", () => {
    // 0.5 ops over half a day: days clamps to 1 → 0.5 op/day → rare
    expect(classify(idx("a_1", [["a", 1]]), { name: "a_1", ops: 0.5, since: NOW - DAY / 2 }, 500, 100, NOW)).toBe(
      "rare",
    );
  });

  it("hidden wins over unused", () => {
    expect(classify(idx("a_1", [["a", 1]], { hidden: true }), use("a_1", 0), 10, 1, NOW)).toBe("hidden");
  });

  it("no usage data → inUse (never a suggestion)", () => {
    expect(classify(idx("a_1", [["a", 1]]), null, 1e9, 1, NOW)).toBe("inUse");
  });
});

describe("redundantWith", () => {
  it("a hidden index never covers another (the planner ignores it)", () => {
    const a = idx("a_1", [["a", 1]]);
    const ab = { ...idx("a_1_b_1", [["a", 1], ["b", 1]]), hidden: true };
    expect(redundantWith(a, [a, ab])).toBeNull();
  });

  it("{a:1} covered by {a:1,b:1}", () => {
    const a = idx("a_1", [["a", 1]]);
    const ab = idx("a_1_b_1", [["a", 1], ["b", 1]]);
    expect(redundantWith(a, [a, ab])).toBe("a_1_b_1");
    expect(redundantWith(ab, [a, ab])).toBeNull();
  });

  it("different direction → null", () => {
    const a = idx("a_-1", [["a", -1]]);
    const ab = idx("a_1_b_1", [["a", 1], ["b", 1]]);
    expect(redundantWith(a, [a, ab])).toBeNull();
  });

  it("equal key pattern is not a strict prefix", () => {
    const a = idx("a_1", [["a", 1]]);
    const a2 = idx("a_1_other", [["a", 1]]);
    expect(redundantWith(a, [a, a2])).toBeNull();
  });

  it("partial / unique / sparse / ttl → null", () => {
    const ab = idx("a_1_b_1", [["a", 1], ["b", 1]]);
    for (const extra of [{ partial: true }, { unique: true }, { sparse: true }, { ttl: 60 }]) {
      const a = idx("a_1", [["a", 1]], extra);
      expect(redundantWith(a, [a, ab])).toBeNull();
      const plainA = idx("a_1", [["a", 1]]);
      const coverer = idx("a_1_b_1", [["a", 1], ["b", 1]], extra);
      expect(redundantWith(plainA, [plainA, coverer])).toBeNull();
    }
  });

  it("_id_ is never redundant", () => {
    const id = idx("_id_", [["_id", 1]]);
    const idx2 = idx("_id_1_x_1", [["_id", 1], ["x", 1]]);
    expect(redundantWith(id, [id, idx2])).toBeNull();
  });

  it("different collation → null", () => {
    const a = idx("a_1", [["a", 1]], { collation: '{"locale":"en"}' });
    const ab = idx("a_1_b_1", [["a", 1], ["b", 1]]);
    expect(redundantWith(a, [a, ab])).toBeNull();
    const ab2 = idx("a_1_b_1_en", [["a", 1], ["b", 1]], { collation: '{"locale":"en"}' });
    expect(redundantWith(a, [a, ab, ab2])).toBe("a_1_b_1_en");
  });

  it("first match in list order", () => {
    const a = idx("a_1", [["a", 1]]);
    const ac = idx("a_1_c_1", [["a", 1], ["c", 1]]);
    const ab = idx("a_1_b_1", [["a", 1], ["b", 1]]);
    expect(redundantWith(a, [a, ac, ab])).toBe("a_1_c_1");
  });
});

describe("dataDays", () => {
  it("3.2 days → 3", () => {
    expect(dataDays([{ name: "a", ops: 1, since: NOW - 3.2 * DAY }], NOW)).toBe(3);
  });
  it("uses the latest since", () => {
    expect(
      dataDays(
        [
          { name: "a", ops: 1, since: NOW - 30 * DAY },
          { name: "b", ops: 1, since: NOW - 2.5 * DAY },
        ],
        NOW,
      ),
    ).toBe(2);
  });
  it("empty → null", () => {
    expect(dataDays([], NOW)).toBeNull();
  });
  it("LOW_CONFIDENCE_DAYS is 7", () => {
    expect(LOW_CONFIDENCE_DAYS).toBe(7);
  });
});

describe("buildIndexRows", () => {
  const infos = [
    idx("_id_", [["_id", 1]]),
    idx("small_used", [["s", 1]]),
    idx("big_used", [["b", 1]]),
    idx("rare_1", [["r", 1]]),
    idx("unused_small", [["u", 1]]),
    idx("unused_big", [["v", 1]]),
    idx("u_1_z_1", [["u", 1], ["z", 1]]),
  ];
  const usage = [
    use("_id_", 1000),
    use("small_used", 1000),
    use("big_used", 1000),
    use("rare_1", 2),
    use("unused_small", 0),
    use("unused_big", 0),
    use("u_1_z_1", 1000),
  ];
  const sizes = {
    _id_: 300,
    small_used: 50,
    big_used: 800,
    rare_1: 600,
    unused_small: 100,
    unused_big: 700,
    u_1_z_1: 200,
  };

  it("orders unused, rare, then size desc", () => {
    const rows = buildIndexRows(infos, usage, sizes, NOW);
    expect(rows.map((r) => r.info.name)).toEqual([
      "unused_big",
      "unused_small",
      "rare_1",
      "big_used",
      "_id_",
      "u_1_z_1",
      "small_used",
    ]);
    expect(rows.map((r) => r.status)).toEqual([
      "unused",
      "unused",
      "rare",
      "inUse",
      "protectedId",
      "inUse",
      "inUse",
    ]);
  });

  it("fills usage, size and redundantWith", () => {
    const rows = buildIndexRows(infos, usage, sizes, NOW);
    const us = rows.find((r) => r.info.name === "unused_small")!;
    expect(us.usage).toEqual(use("unused_small", 0));
    expect(us.size).toBe(100);
    expect(us.redundantWith).toBe("u_1_z_1");
  });

  it("missing usage / size → null, size-less rows last", () => {
    const rows = buildIndexRows([idx("a_1", [["a", 1]]), idx("b_1", [["b", 1]])], [], { b_1: 5 }, NOW);
    expect(rows.map((r) => [r.info.name, r.usage, r.size, r.status])).toEqual([
      ["b_1", null, 5, "inUse"],
      ["a_1", null, null, "inUse"],
    ]);
  });

  it("passes the shard key through", () => {
    const rows = buildIndexRows(
      [idx("k_1", [["k", 1]])],
      [use("k_1", 0)],
      { k_1: 10 },
      NOW,
      ["k"],
    );
    expect(rows[0].status).toBe("protectedShardKey");
  });

  it("unusedSummary counts unused rows and their bytes", () => {
    const rows = buildIndexRows(infos, usage, sizes, NOW);
    expect(unusedSummary(rows)).toEqual({ count: 2, bytes: 800 });
  });
});

describe("parseServerTraits / parseShardKey", () => {
  it("reads hide support, topology and the reporting host", () => {
    expect(parseServerTraits(JSON.stringify({ maxWireVersion: { $numberInt: "21" }, setName: "rs0", me: "db-1:27017" })))
      .toEqual({ canHide: true, topology: "replica", host: "db-1:27017" });
    expect(parseServerTraits(JSON.stringify({ maxWireVersion: 8, msg: "isdbgrid" }))).toEqual({ canHide: false, topology: "sharded", host: null });
    expect(parseServerTraits(JSON.stringify({ maxWireVersion: 9 }))).toEqual({ canHide: true, topology: null, host: null });
    expect(parseServerTraits(null)).toEqual({ canHide: true, topology: null, host: null });
    expect(parseServerTraits("bad")).toEqual({ canHide: true, topology: null, host: null });
  });
  it("shard key fields in order", () => {
    expect(parseShardKey(JSON.stringify({ _id: "shop.orders", key: { customerId: 1, _id: "hashed" } }))).toEqual(["customerId", "_id"]);
    expect(parseShardKey(null)).toBeNull();
    expect(parseShardKey("{}")).toBeNull();
  });
});
