import { describe, it, expect } from "vitest";
import { displayMode, parseRows } from "./scriptOutcome";
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
});

describe("parseRows", () => {
  it("parses ExtJSON rows", () => {
    expect(parseRows([`{"a":1}`])).toEqual([{ a: 1 }]);
  });
});
