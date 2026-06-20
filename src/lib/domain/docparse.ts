import type { Doc } from "./columns";

export type ParseDocumentResult =
  | { ok: true; doc: Doc }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse text JSON → document. Trả lỗi với đúng chuỗi người dùng đang thấy:
 * - cú pháp sai: "JSON sai cú pháp: <message>"
 * - không phải object: "Document phải là một object JSON."
 */
export function parseDocumentText(text: string): ParseDocumentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "JSON sai cú pháp: " + (e as Error).message };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "Document phải là một object JSON." };
  }
  return { ok: true, doc: parsed };
}
