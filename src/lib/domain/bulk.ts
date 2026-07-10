/** Validate update documents and filter helpers for bulk (updateMany/deleteMany) operations. */
export type ParseResult = { ok: true; json: string } | { ok: false; error: string };

/** Validate an update document for updateMany: must be a non-empty object where every top-level key starts with '$', preventing an accidental full-replace. */
export function parseUpdateDoc(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "err_update_empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "err_update_invalid_json" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "err_update_not_object" };
  }

  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length === 0) return { ok: false, error: "err_update_empty" };
  if (!keys.every((k) => k.startsWith("$"))) {
    return { ok: false, error: "err_update_operator_required" };
  }

  return { ok: true, json: trimmed };
}

/** True when the ExtJSON filter is empty ("{}") — drives the whole-collection confirmation checkbox. */
export function isEmptyFilter(json: string): boolean {
  return json.trim() === "{}";
}
