import { describe, it, expect } from "vitest";
import { candidateRefs, scoreCandidate, keepStrong, collectRefValues, MIN_REF_SCORE } from "./refInference";
import type { CollectionSchema, FieldSchema } from "./schema";

const f = (path: string, type: FieldSchema["type"] = "objectId", extra: Partial<FieldSchema> = {}): FieldSchema => ({
  path, type, mixed: false, presence: 1, ...extra,
});
const schema = (...fields: FieldSchema[]): CollectionSchema => ({ sampleSize: 10, fields });

describe("candidateRefs", () => {
  it("detects_objectid_field_matching_plural_collection", () => {
    const out = candidateRefs({
      orders: schema(f("_id"), f("userId")),
      users: schema(f("_id")),
    });
    expect(out).toEqual([{ id: "orders.userId->users", from: "orders", path: "userId", to: "users", many: false }]);
  });

  it("ignores_id_field", () => {
    const out = candidateRefs({ users: schema(f("_id")), orders: schema(f("_id")) });
    expect(out).toEqual([]);
  });

  it("array_of_objectid_is_one_to_many", () => {
    const out = candidateRefs({
      posts: schema(f("_id"), f("tagIds", "array")),
      tags: schema(f("_id")),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "posts", path: "tagIds", to: "tags", many: true });
  });

  it("skips fields that cannot hold an ObjectId and unresolvable names", () => {
    const out = candidateRefs({
      a: schema(f("userId", "string"), f("zzzId"), f("nested.userId"), f("score", "int")),
      users: schema(f("_id")),
    });
    expect(out.map((c) => c.id)).toEqual(["a.nested.userId->users"]);
  });

  it("accepts mixed fields that include objectId", () => {
    const out = candidateRefs({
      a: schema(f("userId", "string", { mixed: true, types: ["string", "objectId"] })),
      users: schema(f("_id")),
    });
    expect(out).toHaveLength(1);
  });
});

describe("scoreCandidate", () => {
  it("is the hit ratio, 0 when nothing was sampled, clamped to 1", () => {
    expect(scoreCandidate(8, 10)).toBe(0.8);
    expect(scoreCandidate(0, 0)).toBe(0);
    expect(scoreCandidate(30, 20)).toBe(1);
  });

  it("score_threshold_filters_weak_matches", () => {
    expect(MIN_REF_SCORE).toBe(0.8);
    const scored = [
      { id: "a", score: scoreCandidate(20, 20) },
      { id: "b", score: scoreCandidate(16, 20) },
      { id: "c", score: scoreCandidate(15, 20) },
    ];
    expect(keepStrong(scored).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("collectRefValues", () => {
  const oid = (n: number) => ({ $oid: n.toString(16).padStart(24, "0") });
  it("collects distinct ObjectIds from scalars and arrays, ignoring other values, up to the limit", () => {
    const docs = [
      { _id: oid(1), userId: oid(10), tagIds: [oid(20), oid(21)] },
      { _id: oid(2), userId: oid(10), tagIds: [oid(21), "x"] },
      { _id: oid(3), userId: "plain" },
    ] as never[];
    expect(collectRefValues(docs, "userId")).toEqual([JSON.stringify(oid(10))]);
    expect(collectRefValues(docs, "tagIds")).toEqual([JSON.stringify(oid(20)), JSON.stringify(oid(21))]);
    expect(collectRefValues(docs, "tagIds", 1)).toHaveLength(1);
  });
});
