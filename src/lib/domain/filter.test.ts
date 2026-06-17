import { describe, it, expect } from "vitest";
import { parseFilter } from "./filter";

describe("parseFilter", () => {
  it("rỗng → {}", () => {
    expect(parseFilter("")).toEqual({ ok: true, json: "{}" });
  });
  it("toàn khoảng trắng → {}", () => {
    expect(parseFilter("   ")).toEqual({ ok: true, json: "{}" });
  });
  it("object hợp lệ → giữ nguyên chuỗi đã trim", () => {
    expect(parseFilter('  {"a":1} ')).toEqual({ ok: true, json: '{"a":1}' });
  });
  it("JSON sai cú pháp → lỗi", () => {
    const r = parseFilter("{a:1");
    expect(r.ok).toBe(false);
  });
  it("mảng bị từ chối", () => {
    const r = parseFilter("[1,2]");
    expect(r.ok).toBe(false);
  });
  it("scalar bị từ chối", () => {
    expect(parseFilter("5").ok).toBe(false);
    expect(parseFilter('"x"').ok).toBe(false);
  });
  it("null bị từ chối", () => {
    expect(parseFilter("null").ok).toBe(false);
  });
});
