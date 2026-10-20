import { describe, it, expect } from "vitest";
import { planPageFetch, DEEP_SKIP_HINT_THRESHOLD, keysetSortDir } from "./keyset";

const boundary = { firstId: { $oid: "aaa" }, lastId: { $oid: "bbb" } };
const base = { sort: [], pageSize: 50, boundary };

describe("planPageFetch", () => {
  it("uses_keyset_for_next_page_on_id_sort", () => {
    const p = planPageFetch({ ...base, fromPage: 2, toPage: 3 });
    expect(p).toEqual({ kind: "keyset", filterPatch: { _id: { $gt: { $oid: "bbb" } } }, reverse: false });
  });

  it("uses_keyset_backwards_and_reverses", () => {
    const p = planPageFetch({ ...base, fromPage: 3, toPage: 2 });
    expect(p).toEqual({ kind: "keyset", filterPatch: { _id: { $lt: { $oid: "aaa" } } }, reverse: true });
  });

  it("uses_skip_for_far_jump", () => {
    expect(planPageFetch({ ...base, fromPage: 1, toPage: 9 })).toEqual({ kind: "skip", skip: 400 });
    expect(planPageFetch({ ...base, fromPage: 5, toPage: 5 })).toEqual({ kind: "skip", skip: 200 });
  });

  it("uses_skip_for_non_id_sort", () => {
    const sort = [{ path: "name", dir: 1 as const }];
    expect(planPageFetch({ ...base, sort, fromPage: 1, toPage: 2 })).toEqual({ kind: "skip", skip: 50 });
    // _id plus another key is not a pure _id order either
    const multi = [{ path: "_id", dir: 1 as const }, { path: "name", dir: 1 as const }];
    expect(planPageFetch({ ...base, sort: multi, fromPage: 1, toPage: 2 }).kind).toBe("skip");
  });

  it("desc_sort_flips_operator", () => {
    const sort = [{ path: "_id", dir: -1 as const }];
    const fwd = planPageFetch({ ...base, sort, fromPage: 1, toPage: 2 });
    expect(fwd).toEqual({ kind: "keyset", filterPatch: { _id: { $lt: { $oid: "bbb" } } }, reverse: false });
    const back = planPageFetch({ ...base, sort, fromPage: 2, toPage: 1 });
    expect(back).toEqual({ kind: "skip", skip: 0 }); // page 1 is always a plain head query
    const back3 = planPageFetch({ ...base, sort, fromPage: 3, toPage: 2 });
    expect(back3).toEqual({ kind: "keyset", filterPatch: { _id: { $gt: { $oid: "aaa" } } }, reverse: true });
  });

  it("uses_skip_without_boundary_or_id", () => {
    expect(planPageFetch({ ...base, boundary: null, fromPage: 1, toPage: 2 }).kind).toBe("skip");
    expect(planPageFetch({ ...base, boundary: { firstId: undefined, lastId: undefined }, fromPage: 1, toPage: 2 }).kind).toBe("skip");
  });

  it("keeps the original BSON wrapper verbatim (string and uuid ids)", () => {
    const b = { firstId: "x", lastId: { $binary: { base64: "AAAA", subType: "04" } } };
    const p = planPageFetch({ ...base, boundary: b, fromPage: 1, toPage: 2 });
    expect(p).toEqual({ kind: "keyset", filterPatch: { _id: { $gt: b.lastId } }, reverse: false });
  });
});

describe("keysetSortDir", () => {
  it("is 1 for empty/asc _id, -1 for desc _id, null otherwise", () => {
    expect(keysetSortDir([])).toBe(1);
    expect(keysetSortDir([{ path: "_id", dir: -1 }])).toBe(-1);
    expect(keysetSortDir([{ path: "a", dir: 1 }])).toBeNull();
  });
  it("threshold", () => expect(DEEP_SKIP_HINT_THRESHOLD).toBe(100_000));
});
