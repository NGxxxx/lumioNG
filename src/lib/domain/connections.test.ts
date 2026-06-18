import { describe, it, expect } from "vitest";
import { validateConnection } from "./connections";

describe("validateConnection", () => {
  it("label rỗng → lỗi", () => {
    expect(validateConnection("  ", "mongodb://x")).toEqual({ ok: false, error: "Tên connection không được rỗng." });
  });
  it("uri rỗng → lỗi", () => {
    expect(validateConnection("L", "  ")).toEqual({ ok: false, error: "URI không được rỗng." });
  });
  it("sai scheme → lỗi", () => {
    expect(validateConnection("L", "http://x")).toEqual({
      ok: false,
      error: "URI phải bắt đầu bằng mongodb:// hoặc mongodb+srv://.",
    });
  });
  it("mongodb:// hợp lệ", () => {
    expect(validateConnection("L", "mongodb://localhost:27017")).toEqual({ ok: true });
  });
  it("mongodb+srv:// hợp lệ", () => {
    expect(validateConnection("Atlas", "mongodb+srv://a.b/c")).toEqual({ ok: true });
  });
});
