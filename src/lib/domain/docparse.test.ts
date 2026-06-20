import { describe, it, expect } from "vitest";
import { parseDocumentText } from "./docparse";

describe("parseDocumentText", () => {
  it("object hợp lệ → ok với doc", () => {
    expect(parseDocumentText('{"a":1}')).toEqual({ ok: true, doc: { a: 1 } });
  });
  it("object lồng/ExtJSON giữ nguyên", () => {
    const r = parseDocumentText('{"_id":{"$oid":"abc"},"n":{"$numberInt":"2"}}');
    expect(r).toEqual({ ok: true, doc: { _id: { $oid: "abc" }, n: { $numberInt: "2" } } });
  });
  it("cú pháp sai → lỗi 'JSON sai cú pháp'", () => {
    const r = parseDocumentText("{ bad json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^JSON sai cú pháp: /);
  });
  it("mảng → lỗi 'phải là một object JSON'", () => {
    expect(parseDocumentText("[1,2]")).toEqual({
      ok: false,
      error: "Document phải là một object JSON.",
    });
  });
  it("scalar → lỗi 'phải là một object JSON'", () => {
    expect(parseDocumentText("42")).toEqual({
      ok: false,
      error: "Document phải là một object JSON.",
    });
  });
  it("null → lỗi 'phải là một object JSON'", () => {
    expect(parseDocumentText("null")).toEqual({
      ok: false,
      error: "Document phải là một object JSON.",
    });
  });
});
