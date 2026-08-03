import { describe, it, expect } from "vitest";
import { parsePipelineFromScript, stagesToScript, stageBodyKind, defaultStageBody, isDefaultStageBody, type StageEntry } from "./pipelineStages";

describe("parsePipelineFromScript", () => {
  it("parses a pure aggregate() call into coll + stage entries", () => {
    const script = 'db.getCollection("orders").aggregate([\n  { "$match": { "status": "shipped" } },\n  { "$limit": 10 }\n])';
    const r = parsePipelineFromScript(script);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coll).toBe("orders");
      expect(r.stages.map((s) => [s.name, s.body])).toEqual([
        ["$match", { status: "shipped" }],
        ["$limit", 10],
      ]);
      expect(r.stages[0].id).not.toBe(r.stages[1].id);
    }
  });

  it("parses a script using constructor-call literals (ObjectId/ISODate)", () => {
    const script = 'db.c.aggregate([{ "$match": { "_id": ObjectId("507f191e810c19729de860ea") } }])';
    const r = parsePipelineFromScript(script);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stages[0].body).toEqual({ _id: { $oid: "507f191e810c19729de860ea" } });
  });

  it("parses a getSiblingDB(...).getCollection(...) chain, matching what autocomplete already accepts", () => {
    const script = 'db.getSiblingDB("other").getCollection("orders").aggregate([{ "$match": { "a": 1 } }])';
    const r = parsePipelineFromScript(script);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coll).toBe("orders");
      expect(r.stages.map((s) => [s.name, s.body])).toEqual([["$match", { a: 1 }]]);
    }
  });

  it("fails for a non-aggregate script", () => {
    expect(parsePipelineFromScript('db.c.find({ "a": 1 })').ok).toBe(false);
  });

  it("fails when the script has more than the single aggregate() call", () => {
    const script = 'const x = 1;\ndb.c.aggregate([{ "$match": {} }])';
    expect(parsePipelineFromScript(script).ok).toBe(false);
  });

  it("fails when a pipeline element isn't a single known-stage-name object", () => {
    expect(parsePipelineFromScript('db.c.aggregate([{ "$match": {}, "$limit": 1 }])').ok).toBe(false);
    expect(parsePipelineFromScript('db.c.aggregate([{ "$notAStage": {} }])').ok).toBe(false);
  });

  it("fails on an empty script", () => {
    expect(parsePipelineFromScript("").ok).toBe(false);
  });
});

describe("stagesToScript", () => {
  it("regenerates runnable script text from stage entries", () => {
    const stages: StageEntry[] = [
      { id: "s1", name: "$match", body: { status: "shipped" } },
      { id: "s2", name: "$limit", body: 10 },
    ];
    const script = stagesToScript("orders", stages);
    expect(script).toBe('db.getCollection("orders").aggregate(\n' + JSON.stringify([{ $match: { status: "shipped" } }, { $limit: 10 }], null, 2) + "\n)");
  });

  it("round-trips through parsePipelineFromScript", () => {
    const stages: StageEntry[] = [{ id: "s1", name: "$sort", body: { createdAt: -1 } }];
    const script = stagesToScript("orders", stages);
    const r = parsePipelineFromScript(script);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.stages.map((s) => [s.name, s.body])).toEqual([["$sort", { createdAt: -1 }]]);
  });
});

describe("stageBodyKind", () => {
  it("classifies a plain object body as object", () => {
    expect(stageBodyKind({ status: "shipped" })).toBe("object");
  });
  it("classifies a bare scalar body as leaf", () => {
    expect(stageBodyKind(10)).toBe("leaf");
    expect(stageBodyKind("$field")).toBe("leaf");
  });
  it("classifies a wrapped BSON scalar object body as leaf", () => {
    expect(stageBodyKind({ $numberLong: "5" })).toBe("leaf");
    expect(stageBodyKind({ $oid: "507f191e810c19729de860ea" })).toBe("leaf");
  });
  it("classifies an array body as unsupported (null)", () => {
    expect(stageBodyKind([1, 2, 3])).toBeNull();
  });
});

describe("defaultStageBody", () => {
  it("seeds a scalar default for scalar-bodied stages", () => {
    expect(defaultStageBody("$limit")).toBe(10);
    expect(defaultStageBody("$count")).toBe("total");
  });
  it("seeds an empty object for object-bodied stages", () => {
    expect(defaultStageBody("$match")).toEqual({});
  });
  it("seeds an unambiguous placeholder for $out, not a plausible real collection name", () => {
    expect(defaultStageBody("$out")).toBe("REPLACE_WITH_COLLECTION_NAME");
  });
});

describe("isDefaultStageBody", () => {
  it("true for a body identical to the stage's own default", () => {
    expect(isDefaultStageBody("$match", {})).toBe(true);
    expect(isDefaultStageBody("$limit", 10)).toBe(true);
    expect(isDefaultStageBody("$sample", { size: 10 })).toBe(true);
  });
  it("false once the body has been edited away from the default", () => {
    expect(isDefaultStageBody("$match", { status: "shipped" })).toBe(false);
    expect(isDefaultStageBody("$limit", 25)).toBe(false);
  });
});
