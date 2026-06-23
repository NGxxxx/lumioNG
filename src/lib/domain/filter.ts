/** Validate and normalize a user-supplied query filter (Extended JSON object). */
export type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

/**
 * Validate the syntax of a user-supplied filter (Extended JSON object).
 * Empty input normalizes to "{}". Operator/BSON-type correctness is left to Rust.
 */
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
