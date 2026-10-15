import { describe, expect, it } from "vitest";
import { normalizeFilter, pushFilter, type FilterHistoryEntry } from "./filterHistory";

const e = (text: string, at = 1, pinned = false): FilterHistoryEntry => ({ text, at, pinned });

describe("normalizeFilter", () => {
  it("removes whitespace outside strings only", () => {
    expect(normalizeFilter(' { "a" : "x  y" ,\n "b": 1 } ')).toBe('{"a":"x  y","b":1}');
  });
  it("respects escaped quotes inside strings", () => {
    expect(normalizeFilter('{ "a": "q \\" z" }')).toBe('{"a":"q \\" z"}');
  });
});

describe("pushFilter", () => {
  it("puts the newest first", () => {
    const out = pushFilter([e('{"a":1}', 1)], '{"b":2}', 2);
    expect(out.map((x) => x.text)).toEqual(['{"b":2}', '{"a":1}']);
    expect(out[0]).toEqual({ text: '{"b":2}', at: 2, pinned: false });
  });
  it("dedupes whitespace-insensitively and moves to front with new time", () => {
    const out = pushFilter([e('{"a":1}', 1), e('{"b":2}', 2)], '{ "b" : 2 }', 5);
    expect(out).toHaveLength(2);
    expect(out[0].at).toBe(5);
    expect(out[1].text).toBe('{"a":1}');
  });
  it("keeps the pinned flag of an existing entry", () => {
    const out = pushFilter([e('{"a":1}', 1, true)], '{ "a": 1 }', 9);
    expect(out).toHaveLength(1);
    expect(out[0].pinned).toBe(true);
    expect(out[0].at).toBe(9);
  });
  it("does not dedupe strings differing only inside literals", () => {
    const out = pushFilter([e('{"a":"x y"}')], '{"a":"x  y"}', 2);
    expect(out).toHaveLength(2);
  });
  it("ignores empty and {} filters", () => {
    const list = [e('{"a":1}')];
    expect(pushFilter(list, "", 2)).toBe(list);
    expect(pushFilter(list, "  ", 2)).toBe(list);
    expect(pushFilter(list, "{ }", 2)).toBe(list);
  });
  it("caps unpinned at 10, dropping the oldest", () => {
    let list: FilterHistoryEntry[] = [];
    for (let i = 0; i < 12; i++) list = pushFilter(list, `{"a":${i}}`, i);
    expect(list).toHaveLength(10);
    expect(list[0].text).toBe('{"a":11}');
    expect(list[9].text).toBe('{"a":2}');
  });
  it("keeps all pinned entries beyond the cap", () => {
    let list: FilterHistoryEntry[] = [];
    for (let i = 0; i < 3; i++) list.push(e(`{"p":${i}}`, i, true));
    for (let i = 0; i < 12; i++) list = pushFilter(list, `{"a":${i}}`, 100 + i);
    expect(list.filter((x) => x.pinned)).toHaveLength(3);
    expect(list.filter((x) => !x.pinned)).toHaveLength(10);
  });
});
