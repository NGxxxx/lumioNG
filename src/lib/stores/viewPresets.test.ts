import { describe, it, expect, beforeEach } from "vitest";
import { viewPresets, PRESETS_KEY } from "./viewPresets.svelte";
import type { ViewPreset } from "../domain/viewPresets";

const p = (name: string, filter = "{}"): ViewPreset => ({ name, filter, sort: [], hidden: [], pinned: [], mode: "grid" });

describe("viewPresets", () => {
  beforeEach(() => {
    for (const ns of ["a", "b"]) for (const x of viewPresets.list(ns)) viewPresets.remove(ns, x.name);
  });

  it("saves per namespace and persists to local storage", () => {
    viewPresets.save("a", p("Active", '{"s":1}'));
    viewPresets.save("b", p("Other"));
    expect(viewPresets.list("a").map((x) => x.name)).toEqual(["Active"]);
    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY)!);
    expect(stored.a[0].filter).toBe('{"s":1}');
    expect(stored.b[0].name).toBe("Other");
  });

  it("saving an existing name replaces it; remove deletes it", () => {
    viewPresets.save("a", p("Active", "{}"));
    viewPresets.save("a", p("active", '{"x":1}'));
    expect(viewPresets.list("a")).toEqual([p("active", '{"x":1}')]);
    viewPresets.remove("a", "active");
    expect(viewPresets.list("a")).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PRESETS_KEY)!).a).toBeUndefined();
  });
});
