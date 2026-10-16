import { describe, it, expect } from "vitest";
import { parsePresets, upsertPreset, type ViewPreset } from "./viewPresets";

const p = (name: string, extra: Partial<ViewPreset> = {}): ViewPreset => ({
  name, filter: "{}", sort: [], hidden: [], pinned: [], mode: "grid", ...extra,
});

describe("parsePresets", () => {
  it("keeps valid presets and drops malformed ones", () => {
    const raw = [
      p("Active", { filter: '{"status":"active"}', sort: [{ path: "at", dir: -1 }], hidden: ["big"], pinned: ["name"], mode: "tree" }),
      { name: "", filter: "{}", sort: [], hidden: [], pinned: [], mode: "grid" },
      { name: "bad sort", filter: "{}", sort: [{ path: "a", dir: 2 }], hidden: [], pinned: [], mode: "grid" },
      { name: "bad mode", filter: "{}", sort: [], hidden: [], pinned: [], mode: "card" },
      null,
      "junk",
    ];
    expect(parsePresets(raw)).toEqual([raw[0]]);
  });

  it("anything that isn't an array is empty", () => {
    expect(parsePresets(null)).toEqual([]);
    expect(parsePresets({ a: 1 })).toEqual([]);
  });
});

describe("upsertPreset", () => {
  it("adds, keeps the list sorted by name, and trims the name", () => {
    expect(upsertPreset([p("b")], p("  a ")).map((x) => x.name)).toEqual(["a", "b"]);
  });

  it("replaces a preset with the same name, ignoring case", () => {
    const out = upsertPreset([p("Active"), p("Other")], p("active", { filter: '{"x":1}' }));
    expect(out.map((x) => [x.name, x.filter])).toEqual([["active", '{"x":1}'], ["Other", "{}"]]);
  });
});
