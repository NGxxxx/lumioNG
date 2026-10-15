import { describe, it, expect } from "vitest";
import {
  fold,
  matchText,
  filterPalette,
  groupMatches,
  splitByRanges,
  namespacePaletteItems,
  parseNamespaceId,
  type PaletteItem,
} from "./palette";

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
