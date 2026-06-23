import { describe, it, expect } from "vitest";
import {
  cycleSort,
  buildSort,
  buildProjection,
  addSortKey,
  toggleSortDir,
  removeSortKey,
  moveSortKey,
  type SortKey,
} from "./grid";

describe("cycleSort (no shift)", () => {
  it("empty → asc for this field", () => {
    expect(cycleSort([], "name", false)).toEqual([{ path: "name", dir: 1 }]);
  });
  it("asc → desc for same field", () => {
    expect(cycleSort([{ path: "name", dir: 1 }], "name", false)).toEqual([{ path: "name", dir: -1 }]);
  });
  it("desc → remove (empty)", () => {
    expect(cycleSort([{ path: "name", dir: -1 }], "name", false)).toEqual([]);
  });
  it("different field clicked → single asc key for new field", () => {
    expect(cycleSort([{ path: "age", dir: -1 }], "name", false)).toEqual([{ path: "name", dir: 1 }]);
  });
  it("multi-key active, plain click → collapses to 1 asc key", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }, { path: "b", dir: -1 }];
    expect(cycleSort(keys, "a", false)).toEqual([{ path: "a", dir: 1 }]);
  });
});

describe("cycleSort (shift)", () => {
  it("new field → appends asc, preserves existing key order", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }];
    expect(cycleSort(keys, "b", true)).toEqual([{ path: "a", dir: 1 }, { path: "b", dir: 1 }]);
  });
  it("existing asc field → desc, other keys untouched", () => {
    const keys: SortKey[] = [{ path: "a", dir: 1 }, { path: "b", dir: 1 }];
    expect(cycleSort(keys, "a", true)).toEqual([{ path: "a", dir: -1 }, { path: "b", dir: 1 }]);
  });
  it("existing desc field → removed from list", () => {
    const keys: SortKey[] = [{ path: "a", dir: -1 }, { path: "b", dir: 1 }];
    expect(cycleSort(keys, "a", true)).toEqual([{ path: "b", dir: 1 }]);
  });
});

describe("buildSort", () => {
  it("empty → null", () => {
    expect(buildSort([])).toBeNull();
  });
  it("1 key → appends _id tie-breaker", () => {
    expect(buildSort([{ path: "age", dir: -1 }])).toBe('{"age":-1,"_id":1}');
  });
  it("multiple keys preserve priority order", () => {
    expect(buildSort([{ path: "a", dir: 1 }, { path: "b", dir: -1 }])).toBe('{"a":1,"b":-1,"_id":1}');
  });
  it("_id already present → no extra tie-breaker", () => {
    expect(buildSort([{ path: "_id", dir: -1 }])).toBe('{"_id":-1}');
  });
});

describe("buildProjection", () => {
  it("empty → null", () => {
    expect(buildProjection(new Set())).toBeNull();
  });
  it("only _id → null (_id is never excluded)", () => {
    expect(buildProjection(new Set(["_id"]))).toBeNull();
  });
  it("several paths → exclusion doc, _id excluded from output", () => {
    expect(buildProjection(new Set(["a", "_id", "b"]))).toBe('{"a":0,"b":0}');
  });
});

describe("addSortKey", () => {
  it("new path → appends asc, preserves existing order", () => {
    expect(addSortKey([{ path: "a", dir: 1 }], "b")).toEqual([
      { path: "a", dir: 1 },
      { path: "b", dir: 1 },
    ]);
  });
  it("existing path → no-op (no duplicate, no direction change)", () => {
    expect(addSortKey([{ path: "a", dir: -1 }], "a")).toEqual([{ path: "a", dir: -1 }]);
  });
});

describe("toggleSortDir", () => {
  it("1 → -1", () => {
    expect(toggleSortDir([{ path: "a", dir: 1 }], "a")).toEqual([{ path: "a", dir: -1 }]);
  });
  it("-1 → 1", () => {
    expect(toggleSortDir([{ path: "a", dir: -1 }], "a")).toEqual([{ path: "a", dir: 1 }]);
  });
  it("path not found → no-op", () => {
    expect(toggleSortDir([{ path: "a", dir: 1 }], "b")).toEqual([{ path: "a", dir: 1 }]);
  });
});

describe("removeSortKey", () => {
  it("removes matching path", () => {
    expect(removeSortKey([{ path: "a", dir: 1 }, { path: "b", dir: 1 }], "a")).toEqual([
      { path: "b", dir: 1 },
    ]);
  });
  it("path not found → no-op", () => {
    expect(removeSortKey([{ path: "a", dir: 1 }], "z")).toEqual([{ path: "a", dir: 1 }]);
  });
});

describe("moveSortKey", () => {
  const keys: SortKey[] = [
    { path: "a", dir: 1 },
    { path: "b", dir: 1 },
    { path: "c", dir: 1 },
  ];
  it("delta -1 moves up one position", () => {
    expect(moveSortKey(keys, "b", -1)).toEqual([
      { path: "b", dir: 1 },
      { path: "a", dir: 1 },
      { path: "c", dir: 1 },
    ]);
  });
  it("delta +1 moves down one position", () => {
    expect(moveSortKey(keys, "b", 1)).toEqual([
      { path: "a", dir: 1 },
      { path: "c", dir: 1 },
      { path: "b", dir: 1 },
    ]);
  });
  it("at start boundary → no-op", () => {
    expect(moveSortKey(keys, "a", -1)).toEqual(keys);
  });
  it("at end boundary → no-op", () => {
    expect(moveSortKey(keys, "c", 1)).toEqual(keys);
  });
  it("path not found → no-op", () => {
    expect(moveSortKey(keys, "z", 1)).toEqual(keys);
  });
});
