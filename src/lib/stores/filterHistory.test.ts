import { describe, it, expect, beforeEach } from "vitest";
import { createFilterHistory, STORAGE_KEY } from "./filterHistory.svelte";
import { prefs } from "./prefs.svelte";

beforeEach(() => prefs.clear());

describe("filterHistory store", () => {
  it("records per namespace, newest first, and persists", () => {
    const h = createFilterHistory();
    h.record("conn:1/shop/orders", '{"a": 1}');
    h.record("conn:1/shop/orders", '{"b": 2}');
    h.record("conn:1/shop/users", '{"c": 3}');
    expect(h.entriesFor("conn:1/shop/orders").map((e) => e.text)).toEqual(['{"b": 2}', '{"a": 1}']);
    const again = createFilterHistory();
    expect(again.entriesFor("conn:1/shop/users").map((e) => e.text)).toEqual(['{"c": 3}']);
  });

  it("pin keeps an entry; clear empties one namespace", () => {
    const h = createFilterHistory();
    h.record("ns", '{"a": 1}');
    h.pin("ns", '{"a": 1}', true);
    expect(h.entriesFor("ns")[0].pinned).toBe(true);
    h.clear("ns");
    expect(h.entriesFor("ns")).toEqual([]);
  });

  it("corrupt storage is ignored", () => {
    prefs.setItem(STORAGE_KEY, "{not json");
    expect(createFilterHistory().entriesFor("ns")).toEqual([]);
    prefs.setItem(STORAGE_KEY, JSON.stringify({ ns: [{ text: 5 }, { text: '{"a":1}', at: 1, pinned: false }] }));
    expect(createFilterHistory().entriesFor("ns").map((e) => e.text)).toEqual(['{"a":1}']);
  });
});
