import { describe, expect, it } from "vitest";
import { nextSteps } from "./nextSteps";
import { expandTemplate } from "./templates";
import { stageWarnings } from "./warnings";

const st = (name: string, body: unknown = {}) => ({ name, body });
const groupStep = { label: "Group ($group)", stage: st("$group", { _id: null, count: { $sum: 1 } }) };
const limit = { label: "Limit 10", stage: st("$limit", 10) };

describe("nextSteps", () => {
  it("empty", () => {
    expect(nextSteps([])).toEqual([{ label: "Filter ($match)", stage: st("$match", {}) }, groupStep]);
  });
  it("after $match", () => {
    expect(nextSteps([st("$match")])).toEqual([groupStep, { label: "Sort", stage: st("$sort", { _id: 1 }) }]);
  });
  it("after $group", () => {
    expect(nextSteps([st("$group", { _id: "$a", total: { $sum: "$t" }, n: { $sum: 1 } })])).toEqual([
      { label: "Sort by total ↓", stage: st("$sort", { total: -1 }) },
      limit,
    ]);
    expect(nextSteps([st("$group", { _id: "$a" })])[0]).toEqual({
      label: "Sort by _id ↓", stage: st("$sort", { _id: -1 }),
    });
  });
  it("after $lookup / $unwind", () => {
    expect(nextSteps([st("$lookup", { from: "c", localField: "a", foreignField: "b", as: "cust" })])).toEqual([
      { label: "Unwind cust", stage: st("$unwind", "$cust") },
    ]);
    const g = { label: "Group by items", stage: st("$group", { _id: "$items", count: { $sum: 1 } }) };
    expect(nextSteps([st("$unwind", "$items")])).toEqual([g]);
    expect(nextSteps([st("$unwind", { path: "$items", preserveNullAndEmptyArrays: true })])).toEqual([g]);
  });
  it("sort / others / terminal", () => {
    expect(nextSteps([st("$sort", { a: 1 })])).toEqual([limit]);
    expect(nextSteps([st("$project", { a: 1 })])).toEqual([limit]);
    for (const n of ["$limit", "$count", "$out", "$merge"]) expect(nextSteps([st(n, 1)])).toEqual([]);
  });
});

describe("expandTemplate", () => {
  it("countBy", () => {
    expect(expandTemplate("countBy", { field: "status" })).toEqual([
      st("$group", { _id: "$status", count: { $sum: 1 } }), st("$sort", { count: -1 }),
    ]);
  });
  it("topN", () => {
    expect(expandTemplate("topN", { field: "status", n: 5 })).toEqual([
      st("$group", { _id: "$status", count: { $sum: 1 } }), st("$sort", { count: -1 }), st("$limit", 5),
    ]);
  });
  it("sumPerMonth", () => {
    expect(expandTemplate("sumPerMonth", { dateField: "at", valueField: "amt" })).toEqual([
      st("$group", { _id: { $dateToString: { format: "%Y-%m", date: "$at" } }, total: { $sum: "$amt" } }),
      st("$sort", { _id: 1 }),
    ]);
  });
  it("join", () => {
    expect(expandTemplate("join", { from: "c", localField: "cid", foreignField: "_id", as: "cust" })).toEqual([
      st("$lookup", { from: "c", localField: "cid", foreignField: "_id", as: "cust" }),
      st("$unwind", { path: "$cust", preserveNullAndEmptyArrays: true }),
    ]);
  });
  it("duplicates", () => {
    expect(expandTemplate("duplicates", { field: "email" })).toEqual([
      st("$group", { _id: "$email", count: { $sum: 1 }, ids: { $push: "$_id" } }),
      st("$match", { count: { $gt: 1 } }),
      st("$sort", { count: -1 }),
    ]);
  });
});

describe("stageWarnings", () => {
  const e = (name: string, body: unknown = {}, enabled = true) => ({ name, body, enabled });
  const none = () => null;
  it("match_after_reshape", () => {
    for (const r of ["$group", "$project", "$unwind", "$addFields", "$set", "$lookup"]) {
      expect(stageWarnings([e(r), e("$match")], none)).toContainEqual({ index: 1, key: "match_after_reshape" });
    }
    expect(stageWarnings([e("$match"), e("$sort")], none)).toEqual([]);
  });
  it("disabled stages are skipped", () => {
    expect(stageWarnings([e("$group", {}, false), e("$match")], none)).toEqual([]);
    expect(stageWarnings([e("$group"), e("$match", {}, false)], none)).toEqual([]);
  });
  it("lookup_unindexed", () => {
    const lk = (f: string) => e("$lookup", { from: "c", localField: "a", foreignField: f, as: "x" });
    const idx = (c: string) => (c === "c" ? ["email"] : null);
    expect(stageWarnings([lk("name")], idx)).toEqual([{ index: 0, key: "lookup_unindexed" }]);
    expect(stageWarnings([lk("email")], idx)).toEqual([]);
    expect(stageWarnings([lk("_id")], () => [])).toEqual([]);
    expect(stageWarnings([lk("name")], none)).toEqual([]);
  });
  it("writes_disable_preview", () => {
    expect(stageWarnings([e("$match"), e("$out", "t")], none)).toEqual([{ index: 1, key: "writes_disable_preview" }]);
    expect(stageWarnings([e("$merge", {})], none)).toEqual([{ index: 0, key: "writes_disable_preview" }]);
    expect(stageWarnings([e("$out", "t", false)], none)).toEqual([]);
  });
});
