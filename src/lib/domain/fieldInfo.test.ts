import { describe, it, expect } from "vitest";
import { chipTypeOf, distinctValueTexts, indexedLeadingFields, fieldInfos } from "./fieldInfo";

describe("fieldInfo", () => {
  it("maps BSON types to chip value types", () => {
    expect(chipTypeOf("int")).toBe("number");
    expect(chipTypeOf("decimal")).toBe("number");
    expect(chipTypeOf("date")).toBe("date");
    expect(chipTypeOf("objectId")).toBe("objectId");
    expect(chipTypeOf("array")).toBe("array");
    expect(chipTypeOf("bool")).toBe("bool");
    expect(chipTypeOf("string")).toBe("string");
    expect(chipTypeOf(undefined)).toBe("unknown");
  });

  it("distinct value texts keep ExtJSON and give up past the cap", () => {
    const docs = [{ s: "a" }, { s: "b" }, { s: "a" }, { n: 1 }, { s: { $numberLong: "9007199254740993" } }];
    expect(distinctValueTexts(docs, "s", 20)).toEqual(['"a"', '"b"', '{"$numberLong":"9007199254740993"}']);
    expect(distinctValueTexts(docs, "s", 2)).toEqual([]);
    expect(distinctValueTexts([{ a: { b: true } }], "a.b", 20)).toEqual(["true"]);
  });

  it("indexed leading fields come from each index's first key", () => {
    const raw = ['{"v":2,"key":{"_id":1},"name":"_id_"}', '{"v":2,"key":{"status":1,"total":-1},"name":"s_t"}'];
    expect([...indexedLeadingFields(raw)].sort()).toEqual(["_id", "status"]);
    expect(indexedLeadingFields(["not json"]).size).toBe(0);
  });

  it("fieldInfos joins columns, presence and indexes", () => {
    const infos = fieldInfos([{ path: "status", type: "string", presence: 0.98 }, { path: "x" }], new Set(["status"]));
    expect(infos).toEqual([
      { path: "status", type: "string", presence: 0.98, indexed: true },
      { path: "x", type: "unknown", presence: null, indexed: false },
    ]);
  });
});
