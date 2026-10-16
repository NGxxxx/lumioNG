import { describe, it, expect } from "vitest";
import {
  fold,
  matchText,
  filterPalette,
  groupMatches,
  splitByRanges,
  namespacePaletteItems,
  parseNamespaceId,
  recentPaletteItems,
  parseRecentCollectionId,
  RECENT_BOOST,
  type PaletteItem,
} from "./palette";
import type { HistoryEntry } from "./queryHistory";

const item = (id: string, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  group: "G",
  label,
  ...extra,
});

describe("fold", () => {
  it("lower-cases and strips Vietnamese diacritics one unit per char", () => {
    expect(fold("Chạy truy vấn")).toBe("chay truy van");
    expect(fold("Đóng")).toBe("dong");
    expect(fold("Chạy truy vấn").length).toBe("Chạy truy vấn".length);
  });
});

describe("matchText", () => {
  it("empty query matches with score 0 and no ranges", () => {
    expect(matchText("orders", "  ")).toEqual({ score: 0, ranges: [] });
  });
  it("substring match returns its range", () => {
    expect(matchText("shop / orders", "ord")?.ranges).toEqual([[7, 10]]);
  });
  it("prefers a word-start occurrence over an earlier mid-word one", () => {
    // "rd" appears inside "ordinal" first, but "rdx" starts a word later.
    expect(matchText("bordx rdx", "rdx")?.ranges).toEqual([[6, 9]]);
  });
  it("prefix beats mid-word substring", () => {
    const a = matchText("orders", "ord")!.score;
    const b = matchText("records", "ord")!.score;
    expect(a).toBeGreaterThan(b);
  });
  it("subsequence match merges adjacent hits and scores below substrings", () => {
    const sub = matchText("new document", "nwd")!;
    expect(sub.ranges).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(sub.score).toBeLessThan(matchText("new document", "new")!.score);
  });
  it("returns null when characters are missing or out of order", () => {
    expect(matchText("orders", "xyz")).toBeNull();
    expect(matchText("abc", "cba")).toBeNull();
  });
  it("matches across diacritics", () => {
    expect(matchText("Chạy truy vấn", "chay")?.ranges).toEqual([[0, 4]]);
  });
});

describe("filterPalette", () => {
  const items = [
    item("a", "Refresh"),
    item("b", "Export", { detail: "shop.orders" }),
    item("c", "orders", { group: "Collections" }),
    item("d", "Disabled orders", { disabled: true }),
    item("e", "Run query", { keywords: "execute" }),
  ];
  it("empty query keeps order and drops disabled items", () => {
    expect(filterPalette(items, "").map((m) => m.item.id)).toEqual(["a", "b", "c", "e"]);
  });
  it("label matches outrank detail/keyword matches, which have no ranges", () => {
    const r = filterPalette(items, "orders");
    expect(r.map((m) => m.item.id)).toEqual(["c", "b"]);
    expect(r[1].ranges).toEqual([]);
  });
  it("keywords can surface an item", () => {
    expect(filterPalette(items, "exec").map((m) => m.item.id)).toEqual(["e"]);
  });
  it("respects the limit", () => {
    expect(filterPalette(items, "", 2)).toHaveLength(2);
  });
});

describe("groupMatches", () => {
  it("orders groups by their best match and keeps match order inside", () => {
    const r = groupMatches([
      { item: item("1", "x", { group: "B" }), score: 9, ranges: [] },
      { item: item("2", "y", { group: "A" }), score: 8, ranges: [] },
      { item: item("3", "z", { group: "B" }), score: 7, ranges: [] },
    ]);
    expect(r.map((g) => [g.group, g.matches.map((m) => m.item.id)])).toEqual([
      ["B", ["1", "3"]],
      ["A", ["2"]],
    ]);
  });
});

describe("splitByRanges", () => {
  it("splits into plain and highlighted parts", () => {
    expect(splitByRanges("shop/orders", [[0, 1], [5, 8]])).toEqual([
      { text: "s", hit: true },
      { text: "hop/", hit: false },
      { text: "ord", hit: true },
      { text: "ers", hit: false },
    ]);
  });
  it("no ranges → single plain part", () => {
    expect(splitByRanges("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});

describe("namespacePaletteItems / parseNamespaceId", () => {
  const items = namespacePaletteItems(
    [
      { name: "shop", collections: ["orders", "a.b"] },
      { name: "empty", collections: [] },
    ],
    { databases: "DBs", collections: "Colls" },
  );
  it("lists collections (with db as detail) before databases", () => {
    expect(items.map((i) => [i.group, i.label, i.detail])).toEqual([
      ["Colls", "orders", "shop"],
      ["Colls", "a.b", "shop"],
      ["DBs", "shop", undefined],
      ["DBs", "empty", undefined],
    ]);
  });
  it("round-trips ids, including names with dots", () => {
    expect(parseNamespaceId(items[1].id)).toEqual({ db: "shop", coll: "a.b" });
    expect(parseNamespaceId(items[3].id)).toEqual({ db: "empty", coll: null });
  });
  it("matches a collection by its full dotted namespace", () => {
    expect(filterPalette(items, "shop.ord")[0].item.label).toBe("orders");
  });
  it("rejects foreign or malformed ids", () => {
    expect(parseNamespaceId("query.run")).toBeNull();
    expect(parseNamespaceId("ns:{bad")).toBeNull();
    expect(parseNamespaceId('ns:[1,2]')).toBeNull();
  });
});

describe("recentPaletteItems", () => {
  const he = (id: string, script: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
    id, tabId: 1, sessionLabel: "local", connId: 1, db: "shop", script, at: 1, ms: 1,
    outcome: { kind: "docs", n: 1 }, runs: 1, ...over,
  });
  it("maps the first 5 distinct queries, then up to 5 collections", () => {
    const q = [he("a", "db.a.find()"), he("b", "db.a.find()"), ...["c", "d", "e", "f", "g"].map((s) => he(s, `db.${s}.find()`))];
    const colls = Array.from({ length: 7 }, (_, i) => ({ connId: 1, db: "d", coll: `c${i}` }));
    const out = recentPaletteItems(q, colls);
    expect(out.map((i) => i.id)).toEqual([
      "recent:q:a", "recent:q:c", "recent:q:d", "recent:q:e", "recent:q:f",
      ...[0, 1, 2, 3, 4].map((i) => `recent:c:1/d/c${i}`),
    ]);
    expect(out.every((i) => i.group === "recent")).toBe(true);
  });
  it("builds label (first non-empty line, 80 chars), detail and keywords", () => {
    const long = "x".repeat(100);
    const [a, b] = recentPaletteItems([he("a", `\n  \n  ${long}\nsecond`), he("b", "y".repeat(600), { db: "crm" })], []);
    expect(a.label).toBe("x".repeat(80));
    expect(a.detail).toBe("local · shop");
    expect(a.keywords).toContain("second");
    expect(b.keywords).toHaveLength(500);
  });
  it("labels collections db.coll, dedupes, and tolerates null connId", () => {
    const out = recentPaletteItems([], [
      { connId: null, db: "shop", coll: "orders" },
      { connId: null, db: "shop", coll: "orders" },
    ]);
    expect(out).toEqual([{ id: "recent:c:/shop/orders", group: "recent", label: "shop.orders" }]);
  });
});

describe("RECENT_BOOST", () => {
  const recent = (id: string, label: string) => item(`recent:${id}`, label, { group: "recent" });
  it("lifts a recent item above an equally-matching non-recent one", () => {
    const r = filterPalette([item("n", "orders"), recent("r", "orders-x")], "ord");
    expect(r[0].item.id).toBe("recent:r");
  });
  it("does not lift a recent item above a clearly better (word-start vs mid-word) match", () => {
    expect(RECENT_BOOST).toBeGreaterThan(0);
    expect(RECENT_BOOST).toBeLessThan(150);
    const r = filterPalette([recent("r", "records"), item("n", "orders")], "ord");
    expect(r[0].item.id).toBe("n");
  });
  it("does not lift a recent subsequence match above a plain substring match", () => {
    const r = filterPalette([recent("r", "o_r_d"), item("n", "a/orders")], "ord");
    expect(r[0].item.id).toBe("n");
  });
});

describe("parseRecentCollectionId", () => {
  it("round-trips the ids recentPaletteItems makes, including names with ':' and '/'", () => {
    const colls = [
      { connId: 3, db: "shop", coll: "orders" },
      { connId: null, db: "app", coll: "events:2024/q1" },
    ];
    const ids = recentPaletteItems([], colls).map((it) => it.id);
    expect(ids.map(parseRecentCollectionId)).toEqual([
      { db: "shop", coll: "orders" },
      { db: "app", coll: "events:2024/q1" },
    ]);
  });

  it("is null for any other id", () => {
    expect(parseRecentCollectionId("recent:q:7")).toBeNull();
    expect(parseRecentCollectionId("recent:c:3/onlydb")).toBeNull();
    expect(parseRecentCollectionId("file.refresh")).toBeNull();
  });
});
