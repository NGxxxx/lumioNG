import { describe, it, expect } from "vitest";
import { idJson, lastIdJson } from "./docid";

describe("idJson", () => {
  it("trả _id dạng Canonical ExtJSON", () => {
    expect(idJson({ _id: { $oid: "507f1f77bcf86cd799439011" }, x: 1 })).toBe(
      '{"$oid":"507f1f77bcf86cd799439011"}',
    );
  });
  it("không có _id → null", () => {
    expect(idJson({ x: 1 })).toBeNull();
  });
});

describe("lastIdJson", () => {
  it("_id ObjectId ($oid) → ExtJSON của doc cuối", () => {
    const docs = [
      { _id: { $oid: "507f1f77bcf86cd799439011" } },
      { _id: { $oid: "507f1f77bcf86cd799439012" } },
    ];
    expect(lastIdJson(docs)).toBe('{"$oid":"507f1f77bcf86cd799439012"}');
  });
  it("_id string → chuỗi ExtJSON của doc cuối", () => {
    expect(lastIdJson([{ _id: "a" }, { _id: "b" }])).toBe('"b"');
  });
  it("_id int ($numberInt) → ExtJSON của doc cuối", () => {
    expect(lastIdJson([{ _id: { $numberInt: "5" } }])).toBe('{"$numberInt":"5"}');
  });
  it("mảng rỗng → null", () => {
    expect(lastIdJson([])).toBeNull();
  });
  it("doc cuối thiếu _id → null", () => {
    expect(lastIdJson([{ _id: "a" }, { x: 1 }])).toBeNull();
  });
});
