/** Pure position-classification for the Pipeline Builder's operator/field suggestions: given a
 *  stage's operator name and the tree depth of an "add field" row inside its body, decide which
 *  extra $-operator suggestions to offer alongside field names. A heuristic, not a full semantic
 *  parser for each stage's grammar (it doesn't know $facet's value is a sub-pipeline, or that $in
 *  expects an array) — it targets the common case: $gt/$in under a field inside $match, $sum/$avg
 *  under an output field inside $group. */
import { QUERY_OPERATORS, EXPR_OPERATORS, type OpEntry } from "./mongoOps";

const ROOT_LOGICAL_LABELS = new Set(["$and", "$or", "$nor", "$expr"]);
const ROOT_MATCH_OPERATORS: OpEntry[] = QUERY_OPERATORS.filter((op) => ROOT_LOGICAL_LABELS.has(op.label));

/** Stages whose nested condition objects use query operators ($gt, $in, $exists, …). */
const QUERY_OPERATOR_STAGES = new Set(["$match"]);
/** Stages whose nested expression objects use aggregation expression operators ($sum, $avg, …). */
const EXPR_OPERATOR_STAGES = new Set(["$group", "$project", "$addFields", "$set", "$bucket", "$replaceRoot"]);

export function operatorSuggestionsFor(stageName: string, depth: number): OpEntry[] {
  if (depth === 0) return stageName === "$match" ? ROOT_MATCH_OPERATORS : [];
  if (QUERY_OPERATOR_STAGES.has(stageName)) return [...QUERY_OPERATORS];
  if (EXPR_OPERATOR_STAGES.has(stageName)) return [...EXPR_OPERATORS];
  return [];
}
