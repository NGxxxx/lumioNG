import { describe, it, expect } from "vitest";
import { parseUpdateDoc, isEmptyFilter } from "./bulk";

describe("parseUpdateDoc", () => {
  it("accepts a valid operator document", () => {
    expect(parseUpdateDoc('{"$set":{"a":1}}')).toEqual({ ok: true, json: '{"$set":{"a":1}}' });
  });
  it("rejects empty input", () => {
    expect(parseUpdateDoc("   ")).toEqual({ ok: false, error: "err_update_empty" });
  });
  it("rejects invalid JSON", () => {
    expect(parseUpdateDoc("{bad")).toEqual({ ok: false, error: "err_update_invalid_json" });
  });
  it("rejects non-object input", () => {
    expect(parseUpdateDoc("[1,2]")).toEqual({ ok: false, error: "err_update_not_object" });
  });
  it("rejects empty object", () => {
    expect(parseUpdateDoc("{}")).toEqual({ ok: false, error: "err_update_empty" });
  });
  it("rejects non-operator keys", () => {
    const r = parseUpdateDoc('{"a":1}');
    expect(r.ok).toBe(false);
  });
  it("rejects mixed operator and plain field keys", () => {
    const r = parseUpdateDoc('{"$set":{},"x":1}');
    expect(r.ok).toBe(false);
  });
});

describe("isEmptyFilter", () => {
  it("'{}' is empty", () => expect(isEmptyFilter("{}")).toBe(true));
  it("whitespace around '{}' is still empty", () => expect(isEmptyFilter(" {} ")).toBe(true));
  it("filter with a field is not empty", () => expect(isEmptyFilter('{"a":1}')).toBe(false));
});
