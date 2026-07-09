/** Suggests a compound index for a COLLSCAN via the Equality-Sort-Range (ESR) rule, computed
 *  from the query's own filter + sort. A heuristic, not a query planner — deliberately
 *  conservative: bails to `null` rather than guessing on `$or`/`$nor`/`$and` or an empty query.
 *  Pure; no Tauri/Svelte. */
import { createIndexCmd } from "./mongosh";

export type IndexSuggestion = { keys: Record<string, 1 | -1>; snippet: string };

const RANGE_OPERATORS = new Set([
  "$gt", "$gte", "$lt", "$lte", "$ne", "$in", "$nin", "$regex", "$exists", "$elemMatch", "$all",
]);

const BAIL_OPERATORS = new Set(["$or", "$nor", "$and"]);

/** True when `v` is shaped like a range/other query operator (has any key from RANGE_OPERATORS). */
function isRangeValue(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.keys(v as Record<string, unknown>).some((k) => RANGE_OPERATORS.has(k));
}

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function suggestIndex(coll: string, filterJson: string, sortJson: string | null): IndexSuggestion | null {
  const filter = parseObject(filterJson || "{}");
  if (!filter) return null;

  const sort = (sortJson ? parseObject(sortJson) : null) ?? {};

  const filterKeys = Object.keys(filter);
  if (filterKeys.some((k) => BAIL_OPERATORS.has(k))) return null;
  if (filterKeys.length === 0 && Object.keys(sort).length === 0) return null;

  // Equality = anything that isn't shaped like a range/other operator — covers plain scalars,
  // {$eq: ...}, and BSON type-wrapper literals ({$oid: ...}, {$numberInt: ...}, {$date: ...}, ...),
  // since those represent a literal value, not a query operator.
  const equalityFields = filterKeys.filter((k) => !isRangeValue(filter[k]));
  const sortFields = Object.keys(sort).filter((k) => !equalityFields.includes(k));
  const rangeFields = filterKeys.filter(
    (k) => !equalityFields.includes(k) && !sortFields.includes(k) && isRangeValue(filter[k]),
  );

  const keys: Record<string, 1 | -1> = {};
  for (const k of equalityFields) keys[k] = 1;
  for (const k of sortFields) {
    const dir = sort[k];
    keys[k] = dir === -1 || dir === "-1" ? -1 : 1;
  }
  for (const k of rangeFields) keys[k] = 1;

  if (Object.keys(keys).length === 0) return null;

  return { keys, snippet: createIndexCmd(coll, keys) };
}
