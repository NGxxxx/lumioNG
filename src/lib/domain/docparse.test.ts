import { describe, it, expect } from "vitest";
import { parseDocumentText } from "./docparse";

describe("parseDocumentText", () => {
  it("valid object → ok with doc", () => {
    expect(parseDocumentText('{"a":1}')).toEqual({ ok: true, doc: { a: 1 } });
  });
  it("nested/ExtJSON object passes through unchanged", () => {
    const r = parseDocumentText('{"_id":{"$oid":"abc"},"n":{"$numberInt":"2"}}');
    expect(r).toEqual({ ok: true, doc: { _id: { $oid: "abc" }, n: { $numberInt: "2" } } });
  });
  it("syntax error → err_doc_syntax key with detail", () => {
    const r = parseDocumentText("{ bad json");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("err_doc_syntax");
      expect(r.detail).toBeTruthy();
    }
  });
  it("array → err_doc_not_object", () => {
    expect(parseDocumentText("[1,2]")).toEqual({
      ok: false,
      error: "err_doc_not_object",
    });
  });
  it("scalar → err_doc_not_object", () => {
    expect(parseDocumentText("42")).toEqual({
      ok: false,
      error: "err_doc_not_object",
    });
  });
  it("null → err_doc_not_object", () => {
    expect(parseDocumentText("null")).toEqual({
      ok: false,
      error: "err_doc_not_object",
    });
  });
});
