/** Parse user-supplied JSON text into a typed document, returning structured error keys on failure. */
import type { Doc } from "./doc";

export type ParseDocumentResult =
  | { ok: true; doc: Doc }
  | { ok: false; error: string; detail?: string };

function isPlainObject(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse text JSON → document, returning a message key on failure (`err_doc_syntax` with optional `detail`, or `err_doc_not_object`). */
export function parseDocumentText(text: string): ParseDocumentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "err_doc_syntax", detail: (e as Error).message };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "err_doc_not_object" };
  }
  return { ok: true, doc: parsed };
}
