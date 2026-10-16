import { parseMongoshValue } from "./mongoshLiteral";

/** Condition kinds `addCondition` can merge into a filter. */
/** `empty` = null, "" or [] (the cell menu's "is empty"). */
export type FilterOp = "eq" | "ne" | "exists" | "notExists" | "empty";

export type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

/** Validate the syntax of a user-supplied filter (Extended JSON or mongosh literal object); empty input normalizes to "{}", operator/BSON-type correctness is left to Rust. */
export function parseFilter(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, json: "{}" };

  // Strict JSON is kept verbatim (big integers, `1.0`, key order); otherwise accept mongosh literal
  // syntax (unquoted keys, single quotes, ObjectId(…), ISODate(…)…) normalized to Extended JSON.
  let parsed: unknown;
  let json = trimmed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const r = parseMongoshValue(trimmed);
    if (!r.ok || trimmed.slice(r.end).trim() !== "") return { ok: false, error: "err_filter_invalid_json" };
    parsed = r.value;
    json = JSON.stringify(r.value);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "err_filter_not_object" };
  }

  return { ok: true, json };
}

/** Merge a single-field condition into the current filter text by splicing it into the user's own text (big integers, `1.0`, key order and duplicates survive); wraps in `$and` when the path or `$or`/`$and` is already used. Returns the parse error when the current text is unusable. */
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
    op === "eq" ? value
    : op === "ne" ? { $ne: value }
    : op === "empty" ? { $in: [null, "", []] }
    : { $exists: op === "exists" };
  const member = `${JSON.stringify(path)}: ${JSON.stringify(cond)}`;

  if (Object.keys(current).length === 0) return { ok: true, text: `{${member}}` };
  if (path in current || "$or" in current || "$and" in current) {
    return { ok: true, text: `{"$and": [${parsed.json}, {${member}}]}` };
  }
  // parseFilter guarantees a non-empty object, so the last "}" closes it.
  const head = parsed.json.slice(0, parsed.json.lastIndexOf("}")).trimEnd();
  return { ok: true, text: `${head}, ${member}${parsed.json.slice(head.length)}` };
}
