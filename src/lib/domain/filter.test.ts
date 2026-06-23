import { describe, it, expect } from "vitest";
import { parseFilter } from "./filter";

describe("parseFilter", () => {
  it("empty → {}", () => {
    expect(parseFilter("")).toEqual({ ok: true, json: "{}" });
  });
  it("whitespace only → {}", () => {
    expect(parseFilter("   ")).toEqual({ ok: true, json: "{}" });
  });
  it("valid object → preserves trimmed string", () => {
    expect(parseFilter('  {"a":1} ')).toEqual({ ok: true, json: '{"a":1}' });
  });
  it("invalid JSON syntax → error", () => {
    const r = parseFilter("{a:1");
    expect(r.ok).toBe(false);
  });
  it("array is rejected", () => {
    const r = parseFilter("[1,2]");
    expect(r.ok).toBe(false);
  });
  it("scalar is rejected", () => {
    expect(parseFilter("5").ok).toBe(false);
    expect(parseFilter('"x"').ok).toBe(false);
  });
  it("null is rejected", () => {
    expect(parseFilter("null").ok).toBe(false);
  });
});
