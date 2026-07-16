/** Parses a raw MongoDB `explain` (verbosity "executionStats") reply — already `JSON.parse`d from
 *  the Canonical ExtJSON string the backend returns — into a normalized summary. Pure; no Tauri/Svelte. */
import { numFromExt } from "./extjson";

export type ExplainStage = {
  name: string;
  nReturned: number | null;
  docsExamined: number | null;
  keysExamined: number | null;
  executionTimeMs: number | null;
};

export type ExplainVerdict = "collscan" | "ixscan" | "ixscan-inefficient" | "other" | "unrecognized";

/** An IXSCAN is flagged inefficient once docsExamined is both this many times nReturned and past
 *  the absolute floor below — small result sets are noisy at any ratio and not worth flagging. */
const INEFFICIENT_RATIO = 10;
const INEFFICIENT_MIN_DOCS_EXAMINED = 100;

export type ExplainSummary = {
  verdict: ExplainVerdict;
  indexName: string | null;
  stages: ExplainStage[];
  totalTimeMs: number | null;
  totalDocsExamined: number | null;
  totalDocsReturned: number | null;
};

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function stageName(stage: Record<string, unknown>): string {
  const s = stage["stage"];
  return typeof s === "string" ? s : "UNKNOWN";
}

function toExplainStage(stage: Record<string, unknown>): ExplainStage {
  return {
    name: stageName(stage),
    nReturned: numFromExt(stage["nReturned"]),
    docsExamined: numFromExt(stage["docsExamined"]),
    keysExamined: numFromExt(stage["keysExamined"]),
    executionTimeMs: numFromExt(stage["executionTimeMillisEstimate"]),
  };
}

/** Depth-first walk from the execution-stage root to its leaf, flattening multi-child `inputStages`, then reversed so the result reads in real execution order (scan first, transforms after). */
function flattenExecutionStages(
  root: Record<string, unknown> | null,
): { stages: ExplainStage[]; indexName: string | null } {
  if (!root) return { stages: [], indexName: null };
  const stages: ExplainStage[] = [];
  let indexName: string | null = null;

  function walk(stage: Record<string, unknown> | null) {
    if (!stage) return;
    stages.push(toExplainStage(stage));
    if (indexName === null && stageName(stage) === "IXSCAN") {
      const n = stage["indexName"];
      if (typeof n === "string") indexName = n;
    }
    const input = asObj(stage["inputStage"]);
    if (input) walk(input);
    const inputs = stage["inputStages"];
    if (Array.isArray(inputs)) {
      for (const s of inputs) {
        const obj = asObj(s);
        if (obj) walk(obj);
      }
    }
  }

  walk(root);
  stages.reverse();
  return { stages, indexName };
}

function emptySummary(): ExplainSummary {
  return {
    verdict: "unrecognized", indexName: null, stages: [],
    totalTimeMs: null, totalDocsExamined: null, totalDocsReturned: null,
  };
}

function buildSummary(
  execRoot: Record<string, unknown> | null,
  executionStats: Record<string, unknown>,
  trailingStageNames: string[],
): ExplainSummary {
  const { stages, indexName } = flattenExecutionStages(execRoot);
  if (stages.length === 0) return emptySummary();

  const totalDocsExamined = numFromExt(executionStats["totalDocsExamined"]);
  const totalDocsReturned = numFromExt(executionStats["nReturned"]);
  const isIxscan = !stages.some((s) => s.name === "COLLSCAN") && stages.some((s) => s.name === "IXSCAN");
  const isInefficient = isIxscan
    && totalDocsExamined !== null && totalDocsReturned !== null
    && totalDocsExamined > INEFFICIENT_MIN_DOCS_EXAMINED
    && totalDocsExamined > totalDocsReturned * INEFFICIENT_RATIO;

  const verdict: ExplainVerdict = stages.some((s) => s.name === "COLLSCAN")
    ? "collscan"
    : isIxscan
      ? (isInefficient ? "ixscan-inefficient" : "ixscan")
      : "other";

  const trailingStages: ExplainStage[] = trailingStageNames.map((name) => ({
    name, nReturned: null, docsExamined: null, keysExamined: null, executionTimeMs: null,
  }));

  return {
    verdict,
    indexName: verdict === "ixscan" || verdict === "ixscan-inefficient" ? indexName : null,
    stages: [...stages, ...trailingStages],
    totalTimeMs: numFromExt(executionStats["executionTimeMillis"]),
    totalDocsExamined,
    totalDocsReturned,
  };
}

export function summarizeExplain(raw: unknown): ExplainSummary {
  const doc = asObj(raw);
  if (!doc) return emptySummary();

  // find-shape (and some server versions' "simple" aggregate shape): queryPlanner + executionStats sit at the top level.
  if (doc["queryPlanner"] !== undefined) {
    const executionStats = asObj(doc["executionStats"]);
    if (!executionStats) return emptySummary();
    return buildSummary(asObj(executionStats["executionStages"]), executionStats, []);
  }

  // aggregate-shape: `stages` array, first `$cursor`-bearing element carries the real stats; subsequent elements are name-only later pipeline stages.
  const stagesArr = doc["stages"];
  if (Array.isArray(stagesArr)) {
    let cursorExecutionStats: Record<string, unknown> | null = null;
    const trailingNames: string[] = [];
    for (const raw of stagesArr) {
      const stage = asObj(raw);
      if (!stage) continue;
      const cursor = asObj(stage["$cursor"]);
      if (cursor && !cursorExecutionStats) {
        cursorExecutionStats = asObj(cursor["executionStats"]);
        continue;
      }
      if (cursorExecutionStats) {
        const opName = Object.keys(stage)[0];
        if (opName) trailingNames.push(opName);
      }
    }
    if (cursorExecutionStats) {
      return buildSummary(asObj(cursorExecutionStats["executionStages"]), cursorExecutionStats, trailingNames);
    }
  }

  return emptySummary();
}
