import type { Doc } from "./columns";

/** Serialize a document's _id back to a Canonical Extended JSON string; null if absent. */
export function idJson(doc: Doc): string | null {
  if (doc._id === undefined) return null;
  return JSON.stringify(doc._id);
}

/**
 * Canonical Extended JSON of the last doc's _id for keyset paging (any _id type);
 * null if the list is empty or the last doc has no _id.
 */
export function lastIdJson(docs: Doc[]): string | null {
  if (docs.length === 0) return null;
  return idJson(docs[docs.length - 1]);
}
