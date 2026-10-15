import { describe, it, expect } from "vitest";
import {
  recordRun,
  groupByDay,
  searchHistory,
  parseStoredHistory,
  HISTORY_CAP,
  type HistoryEntry,
} from "./queryHistory";

const base = (over: Partial<Omit<HistoryEntry, "id" | "runs">> = {}): Omit<HistoryEntry, "id" | "runs"> => ({
  tabId: 1,
  sessionLabel: "local",
  connId: 1,
  db: "shop",
  script: "db.a.find()",
  at: 1000,
  ms: 5,
  outcome: { kind: "docs", n: 3 },
  ...over,
});
const entry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ ...base(), id, runs: 1, ...over });
const ids = () => {
  let i = 0;
  return () => `id${++i}`;
};

describe("recordRun", () => {
  it("prepends a new entry with runs 1", () => {
    const out = recordRun([], base(), ids());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "id1", runs: 1, script: "db.a.find()" });
  });
  it("does not merge into an older entry when the tab's newest entry differs", () => {
    const list = [entry("x", { script: "other" }), entry("y", { at: 1, ms: 1 })];
    const out = recordRun(list, base({ script: "db.a.find()", at: 9, ms: 7, outcome: { kind: "error", message: "boom" } }), ids());
    // newest of tab 1 is "x" (different script) -> must NOT merge into older "y"
    expect(out).toHaveLength(3);
    expect(out[0].id).toBe("id1");
  });
  it("merges when newest entry of that tab matches, even if other tabs are newer", () => {
    const list = [entry("t2", { tabId: 2, script: "zzz" }), entry("y", { at: 1, ms: 1, runs: 2 })];
    const out = recordRun(list, base({ at: 9, ms: 7, outcome: { kind: "error", message: "boom" } }), ids());
    expect(out.map((e) => e.id)).toEqual(["y", "t2"]);
    expect(out[0]).toMatchObject({ runs: 3, at: 9, ms: 7, outcome: { kind: "error", message: "boom" } });
  });
  it("does not merge on different db, different script, or null tabId", () => {
    const list = [entry("y")];
    expect(recordRun(list, base({ db: "other" }), ids())).toHaveLength(2);
    expect(recordRun(list, base({ script: "db.a.find() " }), ids())).toHaveLength(2);
    const nul = [entry("n", { tabId: null })];
    expect(recordRun(nul, base({ tabId: null }), ids())).toHaveLength(2);
  });
  it("caps at HISTORY_CAP dropping the oldest", () => {
    const list = Array.from({ length: HISTORY_CAP }, (_, i) => entry(`e${i}`, { tabId: null, script: `s${i}` }));
    const out = recordRun(list, base({ script: "new" }), ids());
    expect(out).toHaveLength(HISTORY_CAP);
    expect(out[0].script).toBe("new");
    expect(out[out.length - 1].id).toBe(`e${HISTORY_CAP - 2}`);
  });
  it("never mutates the input", () => {
    const list = [entry("y")];
    const snap = JSON.stringify(list);
    recordRun(list, base(), ids());
    recordRun(list, base({ script: "q" }), ids());
    expect(JSON.stringify(list)).toBe(snap);
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 9, 15, 12, 0, 0); // local Oct 15 noon
  const at = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m, d, h, mi, s, ms).getTime();
  const key = (t: number) => groupByDay([entry("e", { at: t })], now)[0].key;

  it("buckets by local calendar day with boundaries", () => {
    expect(key(at(2026, 9, 15, 0, 0, 0, 0))).toBe("today"); // midnight start
    expect(key(at(2026, 9, 14, 23, 59, 59, 999))).toBe("yesterday"); // 1ms before midnight
    expect(key(at(2026, 9, 14, 0, 0))).toBe("yesterday");
    expect(key(at(2026, 9, 13, 23, 59, 59, 999))).toBe("week"); // 2 days ago
    expect(key(at(2026, 9, 9, 0, 0))).toBe("week"); // 6 days ago
    expect(key(at(2026, 9, 8, 23, 59, 59))).toBe("older"); // 7 days ago
  });
  it("omits empty groups and keeps order", () => {
    const list = [
      entry("a", { at: at(2026, 9, 15, 9) }),
      entry("b", { at: at(2026, 9, 14, 9) }),
      entry("c", { at: at(2026, 9, 1, 9) }),
      entry("d", { at: at(2026, 8, 1, 9) }),
    ];
    const g = groupByDay(list, now);
    expect(g.map((x) => x.key)).toEqual(["today", "yesterday", "older"]);
    expect(g[2].entries.map((e) => e.id)).toEqual(["c", "d"]);
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe("searchHistory", () => {
  const list = [
    entry("1", { script: "db.Orders.find()", db: "shop", tabId: 1 }),
    entry("2", { script: "db.users.find()", db: "crm", tabId: 2, outcome: { kind: "error", message: "x" } }),
    entry("3", { script: "db.users.count()", db: "shop", tabId: 1, outcome: { kind: "error", message: "y" } }),
  ];
  it("empty query returns all", () => {
    expect(searchHistory(list, "", {})).toHaveLength(3);
  });
  it("case-insensitive over script and db", () => {
    expect(searchHistory(list, "ORDERS", {}).map((e) => e.id)).toEqual(["1"]);
    expect(searchHistory(list, "CRM", {}).map((e) => e.id)).toEqual(["2"]);
  });
  it("filters by tab and errorsOnly", () => {
    expect(searchHistory(list, "", { tabId: 1 }).map((e) => e.id)).toEqual(["1", "3"]);
    expect(searchHistory(list, "", { errorsOnly: true }).map((e) => e.id)).toEqual(["2", "3"]);
    expect(searchHistory(list, "users", { tabId: 1, errorsOnly: true }).map((e) => e.id)).toEqual(["3"]);
  });
});

describe("parseStoredHistory", () => {
  it("returns [] for null, garbage and non-arrays", () => {
    expect(parseStoredHistory(null)).toEqual([]);
    expect(parseStoredHistory("{not json")).toEqual([]);
    expect(parseStoredHistory('{"a":1}')).toEqual([]);
    expect(parseStoredHistory("42")).toEqual([]);
  });
  it("round-trips valid entries and drops invalid ones", () => {
    const good = entry("g", { tabId: null, connId: null, ms: null, outcome: { kind: "modified", n: 2 } });
    const raw = JSON.stringify([
      good,
      { ...entry("bad1"), script: 5 },
      { ...entry("bad2"), outcome: { kind: "weird" } },
      { ...entry("bad3"), at: "now" },
      null,
      "str",
      { id: "only" },
    ]);
    expect(parseStoredHistory(raw)).toEqual([good]);
  });
  it("caps to HISTORY_CAP", () => {
    const many = Array.from({ length: HISTORY_CAP + 20 }, (_, i) => entry(`e${i}`));
    expect(parseStoredHistory(JSON.stringify(many))).toHaveLength(HISTORY_CAP);
  });
});
