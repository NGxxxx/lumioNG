/** Validate and normalize a user-supplied query filter (Extended JSON object). */
/** Condition kinds `addCondition` can merge into a filter. */
export type FilterOp = "eq" | "ne" | "exists" | "notExists";

export type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

/** Validate the syntax of a user-supplied filter (Extended JSON object); empty input normalizes to "{}", operator/BSON-type correctness is left to Rust. */
export function parseFilter(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, json: "{}" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "err_filter_invalid_json" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "err_filter_not_object" };
  }

  return { ok: true, json: trimmed };
}

/** Merge a single-field condition into the current filter text; returns pretty Extended JSON, or the parse error when the current text is unusable. */
export function addCondition(
  filterText: string,
  path: string,
  op: FilterOp,
  value?: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
  const parsed = parseFilter(filterText);
  if (!parsed.ok) return parsed;
  const current = JSON.parse(parsed.json) as Record<string, unknown>;

  const cond: unknown =
    op === "eq" ? value : op === "ne" ? { $ne: value } : { $exists: op === "exists" };
  const clause = { [path]: cond };

  let next: Record<string, unknown>;
  if (Object.keys(current).length === 0) next = clause;
  else if (Array.isArray(current.$and)) next = { ...current, $and: [...current.$and, clause] };
  else if (path in current || "$or" in current) next = { $and: [current, clause] };
  else next = { ...current, ...clause };

  return { ok: true, text: JSON.stringify(next, null, 2) };
}
