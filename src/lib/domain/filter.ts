export type ParseResult =
  | { ok: true; json: string }
  | { ok: false; error: string };

/**
 * Kiểm CÚ PHÁP filter người dùng (Extended JSON object).
 * Rỗng → "{}". Tính hợp lệ của operator/kiểu BSON do Rust quyết định.
 */
export function parseFilter(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, json: "{}" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Filter không phải JSON hợp lệ." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Filter phải là một object JSON." };
  }

  return { ok: true, json: trimmed };
}
