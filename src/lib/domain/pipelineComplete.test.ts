import { describe, it, expect } from "vitest";
import { operatorSuggestionsFor } from "./pipelineComplete";

describe("operatorSuggestionsFor", () => {
  it("$match at depth 0 offers only the root-level logical operators", () => {
    const labels = operatorSuggestionsFor("$match", 0).map((o) => o.label);
    expect(labels).toEqual(["$and", "$or", "$nor", "$expr"]);
  });

  it("$match at depth 1+ offers the full query-operator pool", () => {
    const labels = operatorSuggestionsFor("$match", 1).map((o) => o.label);
    expect(labels).toContain("$gt");
    expect(labels).toContain("$in");
    expect(labels).toContain("$exists");
  });

  it("$group/$project/$addFields/$set/$bucket/$replaceRoot at depth 1+ offer expression operators", () => {
    for (const stage of ["$group", "$project", "$addFields", "$set", "$bucket", "$replaceRoot"]) {
      const labels = operatorSuggestionsFor(stage, 1).map((o) => o.label);
      expect(labels).toContain("$sum");
      expect(labels).toContain("$cond");
    }
  });

  it("stages with no operator vocabulary offer nothing at any depth", () => {
    for (const stage of ["$sort", "$limit", "$skip", "$unwind", "$count", "$sample", "$out", "$merge", "$unset", "$sortByCount", "$facet"]) {
      expect(operatorSuggestionsFor(stage, 0)).toEqual([]);
      expect(operatorSuggestionsFor(stage, 1)).toEqual([]);
    }
  });

  it("non-$match stages offer nothing at depth 0", () => {
    expect(operatorSuggestionsFor("$group", 0)).toEqual([]);
  });
});
