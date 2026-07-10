import { describe, it, expect } from "vitest";
import { compileSearch, docMatchesSearch, matchingIndices } from "./search";

describe("compileSearch", () => {
  it("returns null for an empty term", () => {
    expect(compileSearch("")).toBeNull();
  });

  it("compiles a valid pattern case-insensitively", () => {
    const re = compileSearch("ab.c");
    expect(re).not.toBeNull();
    expect(re!.test("XXabYcXX")).toBe(true);
    expect(re!.test("no match")).toBe(false);
  });

  it("returns null for an invalid pattern instead of throwing", () => {
    expect(compileSearch("[unterminated")).toBeNull();
  });
});

describe("docMatchesSearch", () => {
  const columns = [{ path: "name" }, { path: "_id" }, { path: "tags" }];

  it("matches a plain string field", () => {
    const doc = { _id: { $oid: "abc123" }, name: "Widget" };
    expect(docMatchesSearch(doc, columns, /widg/i)).toBe(true);
    expect(docMatchesSearch(doc, columns, /gizmo/i)).toBe(false);
  });

  it("matches against the ObjectId's displayed hex string", () => {
    const doc = { _id: { $oid: "deadbeef0000000000000001" }, name: "x" };
    expect(docMatchesSearch(doc, columns, /deadbeef/i)).toBe(true);
  });

  it("matches a nested/array field via its column path", () => {
    const doc = { _id: { $oid: "a" }, tags: ["red", "blue"] };
    expect(docMatchesSearch(doc, columns, /blue/i)).toBe(true);
  });
});

describe("matchingIndices", () => {
  const columns = [{ path: "name" }];
  const docs = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];

  it("returns null (unfiltered) when re is null", () => {
    expect(matchingIndices(docs, columns, null)).toBeNull();
  });

  it("returns the indices of matching rows, preserving order", () => {
    expect(matchingIndices(docs, columns, /^(alpha|gamma)$/i)).toEqual([0, 2]);
  });

  it("returns an empty array (not null) when nothing matches", () => {
    expect(matchingIndices(docs, columns, /zzz/i)).toEqual([]);
  });
});
