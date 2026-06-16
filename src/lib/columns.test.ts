import { describe, it, expect } from "vitest";
import { deriveColumnKeys } from "./columns";

describe("deriveColumnKeys", () => {
  it("union key cấp 1, _id luôn đứng đầu", () => {
    const docs = [
      { _id: { $oid: "1" }, name: "a", age: { $numberInt: "1" } },
      { _id: { $oid: "2" }, name: "b", email: "x@y.z" },
    ];
    expect(deriveColumnKeys(docs)).toEqual(["_id", "name", "age", "email"]);
  });
  it("giữ thứ tự xuất hiện lần đầu", () => {
    const docs = [{ _id: { $oid: "1" }, b: 1, a: 2 }];
    expect(deriveColumnKeys(docs)).toEqual(["_id", "b", "a"]);
  });
  it("doc lệch schema vẫn gộp đủ key", () => {
    const docs = [{ _id: { $oid: "1" } }, { _id: { $oid: "2" }, extra: 1 }];
    expect(deriveColumnKeys(docs)).toEqual(["_id", "extra"]);
  });
  it("rỗng → mảng rỗng", () => {
    expect(deriveColumnKeys([])).toEqual([]);
  });
});
