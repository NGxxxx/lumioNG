import { describe, it, expect } from "vitest";
import { parseUpdateDoc, isEmptyFilter } from "./bulk";

describe("parseUpdateDoc", () => {
  it("chấp nhận operator hợp lệ", () => {
    expect(parseUpdateDoc('{"$set":{"a":1}}')).toEqual({ ok: true, json: '{"$set":{"a":1}}' });
  });
  it("từ chối rỗng", () => {
    expect(parseUpdateDoc("   ")).toEqual({ ok: false, error: "Update không được rỗng." });
  });
  it("từ chối JSON sai", () => {
    expect(parseUpdateDoc("{bad")).toEqual({ ok: false, error: "Update không phải JSON hợp lệ." });
  });
  it("từ chối không phải object", () => {
    expect(parseUpdateDoc("[1,2]")).toEqual({ ok: false, error: "Update phải là một object JSON." });
  });
  it("từ chối object rỗng", () => {
    expect(parseUpdateDoc("{}")).toEqual({ ok: false, error: "Update không được rỗng." });
  });
  it("từ chối key không phải operator", () => {
    const r = parseUpdateDoc('{"a":1}');
    expect(r.ok).toBe(false);
  });
  it("từ chối khi mix operator và field thường", () => {
    const r = parseUpdateDoc('{"$set":{},"x":1}');
    expect(r.ok).toBe(false);
  });
});

describe("isEmptyFilter", () => {
  it("'{}' là rỗng", () => expect(isEmptyFilter("{}")).toBe(true));
  it("khoảng trắng quanh '{}' vẫn rỗng", () => expect(isEmptyFilter(" {} ")).toBe(true));
  it("filter có field không rỗng", () => expect(isEmptyFilter('{"a":1}')).toBe(false));
});
