import { describe, it, expect } from "vitest";
import { cycleSort, buildSort, buildProjection, type SortKey } from "./grid";

describe("cycleSort (không shift)", () => {
  it("rỗng → asc field này", () => {
    expect(cycleSort([], "name", false)).toEqual([{ path: "name", dir: 1 }]);
  });
  it("asc → desc cùng field", () => {
    expect(cycleSort([{ path: "name", dir: 1 }], "name", false)).toEqual([{ path: "name", dir: -1 }]);
  });
  it("desc → bỏ (rỗng)", () => {
    expect(cycleSort([{ path: "name", dir: -1 }], "name", false)).toEqual([]);
  });
  it("click field khác → chỉ còn 1 khóa asc của field mới", () => {
    expect(cycleSort([{ path: "age", dir: -1 }], "name", false)).toEqual([{ path: "name", dir: 1 }]);
  });
  it("đang đa khóa, click thường → chỉ còn 1 khóa asc", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }, { path: "b", dir: -1 }];
    expect(cycleSort(keys, "a", false)).toEqual([{ path: "a", dir: 1 }]);
  });
});

describe("cycleSort (shift)", () => {
  it("field mới → append asc, giữ thứ tự khóa cũ", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }];
    expect(cycleSort(keys, "b", true)).toEqual([{ path: "a", dir: 1 }, { path: "b", dir: 1 }]);
  });
  it("field đã có asc → desc, không xáo trộn khóa khác", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }, { path: "b", dir: 1 }];
    expect(cycleSort(keys, "a", true)).toEqual([{ path: "a", dir: -1 }, { path: "b", dir: 1 }]);
  });
  it("field đã có desc → bỏ khỏi danh sách", () => {
    const keys: SortKey[] = [{ path: "a", dir: -1 }, { path: "b", dir: 1 }];
    expect(cycleSort(keys, "a", true)).toEqual([{ path: "b", dir: 1 }]);
  });
});

describe("buildSort", () => {
  it("rỗng → null", () => {
    expect(buildSort([])).toBeNull();
  });
  it("1 khóa → nối tie-breaker _id, giữ thứ tự", () => {
    expect(buildSort([{ path: "age", dir: -1 }])).toBe('{"age":-1,"_id":1}');
  });
  it("đa khóa giữ thứ tự ưu tiên", () => {
    expect(buildSort([{ path: "a", dir: 1 }, { path: "b", dir: -1 }])).toBe('{"a":1,"b":-1,"_id":1}');
  });
  it("đã có khóa _id → không nối thêm", () => {
    expect(buildSort([{ path: "_id", dir: -1 }])).toBe('{"_id":-1}');
  });
});

describe("buildProjection", () => {
  it("rỗng → null", () => {
    expect(buildProjection(new Set())).toBeNull();
  });
  it("chỉ có _id → null (không loại _id)", () => {
    expect(buildProjection(new Set(["_id"]))).toBeNull();
  });
  it("vài path → exclusion doc, loại _id", () => {
    expect(buildProjection(new Set(["a", "_id", "b"]))).toBe('{"a":0,"b":0}');
  });
});
