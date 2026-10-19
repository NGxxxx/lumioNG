import { describe, expect, it } from "vitest";
import { STAGE_CODECS, STAGE_CATEGORIES, expandTemplate, stageWarnings, deepEqualOrdered } from "./index";
import { PIPELINE_STAGES } from "../mongoOps";
import { defaultStageBody, pipelineToJson } from "../pipelineStages";

function roundTrip(name: string, body: unknown) {
  const c = STAGE_CODECS[name];
  const m = c.parse(body);
  expect(m).not.toBeNull();
  expect(deepEqualOrdered(c.build(m), body)).toBe(true);
  return m;
}
const rejects = (name: string, body: unknown) => expect(STAGE_CODECS[name].parse(body)).toBeNull();

describe("new stage forms", () => {
  it("$sample", () => {
    expect(roundTrip("$sample", { size: 25 })).toBe(25);
    rejects("$sample", { size: 0 });
    rejects("$sample", { size: 2.5 });
    rejects("$sample", { size: 3, extra: 1 });
    expect(STAGE_CODECS.$sample.summarize(25)).toBe("25 random");
  });

  it("$sortByCount", () => {
    expect(roundTrip("$sortByCount", "$status")).toBe("status");
    rejects("$sortByCount", { $toLower: "$s" });
    rejects("$sortByCount", "status");
  });

  it("$replaceRoot", () => {
    expect(roundTrip("$replaceRoot", { newRoot: "$customer" })).toBe("customer");
    rejects("$replaceRoot", { newRoot: { $mergeObjects: ["$a", "$b"] } });
    rejects("$replaceRoot", { newRoot: "$a", x: 1 });
  });

  it("$unset", () => {
    expect(roundTrip("$unset", "secret")).toEqual(["secret"]);
    expect(roundTrip("$unset", ["a", "b.c"])).toEqual(["a", "b.c"]);
    rejects("$unset", ["only"]); // would rebuild as the bare string
    rejects("$unset", ["a", 1]);
    rejects("$unset", "");
  });

  it("every new stage's default body opens in its form", () => {
    for (const name of ["$sample", "$sortByCount", "$replaceRoot", "$unset"]) {
      expect(STAGE_CODECS[name].parse(defaultStageBody(name))).not.toBeNull();
    }
  });
});

describe("stage catalog", () => {
  it("files every pipeline stage under exactly one category", () => {
    const listed = STAGE_CATEGORIES.flatMap((c) => c.stages);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(PIPELINE_STAGES.map((s) => s.label).sort());
  });
});

describe("more templates", () => {
  it("latest N by date", () => {
    expect(expandTemplate("latest", { dateField: "createdAt", n: 5 })).toEqual([
      { name: "$sort", body: { createdAt: -1 } },
      { name: "$limit", body: 5 },
    ]);
  });
  it("distinct values", () => {
    expect(expandTemplate("distinct", { field: "status" })).toEqual([
      { name: "$group", body: { _id: "$status" } },
      { name: "$sort", body: { _id: 1 } },
    ]);
  });
  it("count per day", () => {
    const [g] = expandTemplate("countPerDay", { dateField: "at" });
    expect(g.body).toEqual({ _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } }, count: { $sum: 1 } });
  });
});

describe("sort after limit warning", () => {
  const w = (names: string[]) => stageWarnings(names.map((name) => ({ name, body: {}, enabled: true })), () => null);
  it("flags a $sort that follows a $limit", () => {
    expect(w(["$limit", "$sort"])).toEqual([{ index: 1, key: "sort_after_limit" }]);
  });
  it("is cleared by a grouping stage in between", () => {
    expect(w(["$limit", "$group", "$sort"]).filter((x) => x.key === "sort_after_limit")).toEqual([]);
    expect(w(["$sort", "$limit"])).toEqual([]);
  });
});

describe("pipelineToJson", () => {
  it("keeps enabled stages only, as a pretty pipeline array", () => {
    const text = pipelineToJson([
      { name: "$match", body: { a: 1 } },
      { name: "$limit", body: 5, enabled: false },
      { name: "$sort", body: { a: -1 } },
    ]);
    expect(JSON.parse(text)).toEqual([{ $match: { a: 1 } }, { $sort: { a: -1 } }]);
    expect(text).toContain("\n  ");
  });
});
