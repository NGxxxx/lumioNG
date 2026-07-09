import { describe, it, expect } from "vitest";
import { displayMode, parseRows, nextResultView } from "./scriptOutcome";
import type { ScriptOutcome } from "../api/script";

const base: ScriptOutcome = { console: [], result: { kind: "none" }, provenance: null, capped: false, error: null };

describe("displayMode", () => {
  it("docs + provenance → grid-editable", () => {
    expect(displayMode({ ...base, result: { kind: "docs", rows: [] }, provenance: { db: "d", coll: "c" } })).toBe("grid-editable");
  });
  it("docs without provenance → grid-readonly", () => {
    expect(displayMode({ ...base, result: { kind: "docs", rows: [] } })).toBe("grid-readonly");
  });
  it("ack/value/none map through", () => {
    expect(displayMode({ ...base, result: { kind: "ack", json: "{}" } })).toBe("ack");
    expect(displayMode({ ...base, result: { kind: "value", json: "1" } })).toBe("value");
    expect(displayMode(base)).toBe("none");
  });

  it("cursorQuery + provenance → grid-editable", () => {
    const cursorQueryResult = {
      kind: "cursorQuery" as const,
      cursorKind: "find" as const,
      db: "d", coll: "c", query: "{}", sort: null, projection: null,
      baseSkip: 0, fixedLimit: null,
    };
    expect(displayMode({ ...base, result: cursorQueryResult, provenance: { db: "d", coll: "c" } })).toBe("grid-editable");
  });

  it("cursorQuery without provenance → grid-readonly", () => {
    const cursorQueryResult = {
      kind: "cursorQuery" as const,
      cursorKind: "find" as const,
      db: "d", coll: "c", query: "{}", sort: null, projection: null,
      baseSkip: 0, fixedLimit: null,
    };
    expect(displayMode({ ...base, result: cursorQueryResult, provenance: null })).toBe("grid-readonly");
  });
});

describe("parseRows", () => {
  it("parses ExtJSON rows", () => {
    expect(parseRows([`{"a":1}`])).toEqual([{ a: 1 }]);
  });
});

describe("nextResultView", () => {
  it("console-only output (mode none, has console text) always jumps to console", () => {
    expect(nextResultView("grid", "none", true)).toBe("console");
    expect(nextResultView("tree", "none", true)).toBe("console");
    expect(nextResultView("console", "none", true)).toBe("console");
  });

  it("leaving console on a docs result lands on grid", () => {
    expect(nextResultView("console", "grid-editable", false)).toBe("grid");
    expect(nextResultView("console", "grid-readonly", false)).toBe("grid");
  });

  it("leaving console on an ack/value result lands on grid", () => {
    expect(nextResultView("console", "ack", false)).toBe("grid");
    expect(nextResultView("console", "value", false)).toBe("grid");
  });

  it("already on grid/tree with a docs result keeps the current choice", () => {
    expect(nextResultView("grid", "grid-editable", false)).toBe("grid");
    expect(nextResultView("tree", "grid-editable", false)).toBe("tree");
    expect(nextResultView("tree", "grid-readonly", false)).toBe("tree");
  });

  it("none with no console output leaves the current view unchanged", () => {
    expect(nextResultView("grid", "none", false)).toBe("grid");
    expect(nextResultView("tree", "none", false)).toBe("tree");
  });
});
