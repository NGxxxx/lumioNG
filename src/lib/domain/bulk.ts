export type ParseResult = { ok: true; json: string } | { ok: false; error: string };

/**
 * Validate update document cho updateMany: object, không rỗng, MỌI top-level key
 * bắt đầu bằng '$' (chặn nhầm thay-thế-cả-doc). Tính hợp lệ toán tử do Rust/driver quyết định.
 */
export function parseUpdateDoc(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Update không được rỗng." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Update không phải JSON hợp lệ." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Update phải là một object JSON." };
  }

  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.length === 0) return { ok: false, error: "Update không được rỗng." };
  if (!keys.every((k) => k.startsWith("$"))) {
    return { ok: false, error: "Mọi toán tử phải bắt đầu bằng '$' (vd $set, $inc, $unset)." };
  }

  return { ok: true, json: trimmed };
}

/** True khi filter ExtJSON là rỗng ("{}") — quyết định có cần checkbox xác nhận toàn-collection. */
export function isEmptyFilter(json: string): boolean {
  return json.trim() === "{}";
}
