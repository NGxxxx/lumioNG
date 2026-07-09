import { describe, it, expect } from "vitest";
import { summarizeExplain } from "./explainPlan";

describe("summarizeExplain", () => {
  it("find-shape COLLSCAN produces a collscan verdict with one stage", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
      executionStats: {
        nReturned: { $numberInt: "42" },
        executionTimeMillis: { $numberInt: "12" },
        totalKeysExamined: { $numberInt: "0" },
        totalDocsExamined: { $numberInt: "10000" },
        executionStages: {
          stage: "COLLSCAN",
          nReturned: { $numberInt: "42" },
          executionTimeMillisEstimate: { $numberInt: "10" },
          docsExamined: { $numberInt: "10000" },
        },
      },
    };
    const s = summarizeExplain(raw);
    expect(s.verdict).toBe("collscan");
    expect(s.indexName).toBeNull();
    expect(s.stages).toEqual([
      { name: "COLLSCAN", nReturned: 42, docsExamined: 10000, keysExamined: null, executionTimeMs: 10 },
    ]);
    expect(s.totalTimeMs).toBe(12);
    expect(s.totalDocsExamined).toBe(10000);
    expect(s.totalDocsReturned).toBe(42);
  });

  it("find-shape IXSCAN reverses input-stage order so the index scan comes first", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "FETCH" } },
      executionStats: {
        nReturned: { $numberInt: "3" },
        executionTimeMillis: { $numberInt: "2" },
        totalDocsExamined: { $numberInt: "3" },
        executionStages: {
          stage: "FETCH",
          nReturned: { $numberInt: "3" },
          executionTimeMillisEstimate: { $numberInt: "2" },
          docsExamined: { $numberInt: "3" },
          inputStage: {
            stage: "IXSCAN",
            nReturned: { $numberInt: "3" },
            executionTimeMillisEstimate: { $numberInt: "1" },
            keysExamined: { $numberInt: "3" },
            indexName: "status_1",
          },
        },
      },
    };
    const s = summarizeExplain(raw);
    expect(s.verdict).toBe("ixscan");
    expect(s.indexName).toBe("status_1");
    expect(s.stages.map((st) => st.name)).toEqual(["IXSCAN", "FETCH"]);
  });

  it("aggregate $cursor-shape reads cursor stats and appends trailing pipeline stage names", () => {
    const raw = {
      stages: [
        {
          "$cursor": {
            queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
            executionStats: {
              nReturned: { $numberInt: "5" },
              executionTimeMillis: { $numberInt: "8" },
              totalDocsExamined: { $numberInt: "500" },
              executionStages: {
                stage: "COLLSCAN",
                nReturned: { $numberInt: "5" },
                executionTimeMillisEstimate: { $numberInt: "7" },
                docsExamined: { $numberInt: "500" },
              },
            },
          },
        },
        { "$group": { _id: "$status" } },
      ],
    };
    const s = summarizeExplain(raw);
    expect(s.verdict).toBe("collscan");
    expect(s.stages.map((st) => st.name)).toEqual(["COLLSCAN", "$group"]);
    expect(s.stages[1]).toEqual({
      name: "$group", nReturned: null, docsExamined: null, keysExamined: null, executionTimeMs: null,
    });
  });

  it("sharded explain (shards array) is unrecognized", () => {
    const s = summarizeExplain({ shards: [{ host: "a" }] });
    expect(s.verdict).toBe("unrecognized");
    expect(s.stages).toEqual([]);
  });

  it("malformed or empty input degrades to unrecognized without throwing", () => {
    expect(() => summarizeExplain(null)).not.toThrow();
    expect(summarizeExplain(null).verdict).toBe("unrecognized");
    expect(summarizeExplain("not an object").verdict).toBe("unrecognized");
    expect(summarizeExplain({}).verdict).toBe("unrecognized");
  });

  it("IDHACK (neither COLLSCAN nor IXSCAN) is verdict 'other'", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "IDHACK" } },
      executionStats: {
        nReturned: { $numberInt: "1" },
        executionTimeMillis: { $numberInt: "0" },
        totalDocsExamined: { $numberInt: "1" },
        executionStages: {
          stage: "IDHACK",
          nReturned: { $numberInt: "1" },
          executionTimeMillisEstimate: { $numberInt: "0" },
          docsExamined: { $numberInt: "1" },
        },
      },
    };
    expect(summarizeExplain(raw).verdict).toBe("other");
  });
});
