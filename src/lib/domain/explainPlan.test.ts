import { describe, it, expect } from "vitest";
import { summarizeExplain, explainFlow, efficiency, explainAdvice } from "./explainPlan";

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

  it("IXSCAN with docsExamined >> nReturned is verdict 'ixscan-inefficient'", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "FETCH" } },
      executionStats: {
        nReturned: { $numberInt: "10" },
        executionTimeMillis: { $numberInt: "40" },
        totalDocsExamined: { $numberInt: "5000" },
        executionStages: {
          stage: "FETCH",
          nReturned: { $numberInt: "10" },
          executionTimeMillisEstimate: { $numberInt: "40" },
          docsExamined: { $numberInt: "5000" },
          inputStage: {
            stage: "IXSCAN",
            nReturned: { $numberInt: "5000" },
            executionTimeMillisEstimate: { $numberInt: "35" },
            keysExamined: { $numberInt: "5000" },
            indexName: "status_1",
          },
        },
      },
    };
    const s = summarizeExplain(raw);
    expect(s.verdict).toBe("ixscan-inefficient");
    expect(s.indexName).toBe("status_1");
  });

  it("IXSCAN ratio above threshold but docsExamined below the absolute floor stays 'ixscan'", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "FETCH" } },
      executionStats: {
        nReturned: { $numberInt: "1" },
        executionTimeMillis: { $numberInt: "1" },
        totalDocsExamined: { $numberInt: "50" },
        executionStages: {
          stage: "FETCH",
          nReturned: { $numberInt: "1" },
          executionTimeMillisEstimate: { $numberInt: "1" },
          docsExamined: { $numberInt: "50" },
          inputStage: { stage: "IXSCAN", nReturned: { $numberInt: "50" }, indexName: "a_1" },
        },
      },
    };
    expect(summarizeExplain(raw).verdict).toBe("ixscan");
  });

  it("IXSCAN with docsExamined close to nReturned stays 'ixscan'", () => {
    const raw = {
      queryPlanner: { winningPlan: { stage: "FETCH" } },
      executionStats: {
        nReturned: { $numberInt: "150" },
        executionTimeMillis: { $numberInt: "5" },
        totalDocsExamined: { $numberInt: "160" },
        executionStages: {
          stage: "FETCH",
          nReturned: { $numberInt: "150" },
          executionTimeMillisEstimate: { $numberInt: "5" },
          docsExamined: { $numberInt: "160" },
          inputStage: { stage: "IXSCAN", nReturned: { $numberInt: "160" }, indexName: "a_1" },
        },
      },
    };
    expect(summarizeExplain(raw).verdict).toBe("ixscan");
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

describe("explain flow, efficiency and advice", () => {
  const aggExplain = {
    stages: [
      { $cursor: { executionStats: { executionTimeMillis: 40, totalDocsExamined: 48213, nReturned: 120,
        executionStages: { stage: "PROJECTION_SIMPLE", nReturned: 120, executionTimeMillisEstimate: 39,
          inputStage: { stage: "COLLSCAN", nReturned: 120, docsExamined: 48213, executionTimeMillisEstimate: 38 } } } } },
      { $group: { _id: "$tier" }, nReturned: 3, executionTimeMillisEstimate: 41 },
      { $sort: { sortKey: { count: -1 } }, nReturned: 3, executionTimeMillisEstimate: 41 },
    ],
  };

  it("aggregate trailing stages carry their reported numbers", () => {
    const s = summarizeExplain(aggExplain);
    expect(s.stages.map((x) => x.name)).toEqual(["COLLSCAN", "PROJECTION_SIMPLE", "$group", "$sort"]);
    expect(s.stages[2]).toMatchObject({ nReturned: 3, executionTimeMs: 41 });
  });

  it("flow rows scale by documents and mark the slowest stage", () => {
    const rows = explainFlow(summarizeExplain(aggExplain));
    expect(rows[0]).toMatchObject({ name: "COLLSCAN", docs: 48213, returned: 120, widthPct: 100 });
    expect(rows[2].widthPct).toBeLessThan(1);
    expect(rows.filter((r) => r.slowest).map((r) => r.name)).toEqual(["$group"]);
  });

  it("efficiency is returned / examined", () => {
    expect(efficiency(summarizeExplain(aggExplain))).toEqual({ returned: 120, examined: 48213, pct: 0.2 });
    expect(efficiency({ ...summarizeExplain(aggExplain), totalDocsExamined: 0 })).toBeNull();
  });

  it("advice: index for a collection scan, $match after $group, in-memory sort", () => {
    const s = summarizeExplain(aggExplain);
    const pipeline = [{ name: "$group", body: {} }, { name: "$match", body: { a: 1 } }];
    expect(explainAdvice(s, pipeline).map((a) => a.key)).toEqual(["create_index", "move_match_first"]);
    const sorted = { ...s, verdict: "ixscan" as const, stages: [...s.stages, { name: "SORT", nReturned: 1, docsExamined: null, keysExamined: null, executionTimeMs: 1 }] };
    expect(explainAdvice(sorted, null).map((a) => a.key)).toEqual(["in_memory_sort"]);
  });
});
