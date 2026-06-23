import type { Doc } from "./doc";

/** Serialize a document's _id back to a Canonical Extended JSON string; null if absent. */
export function idJson(doc: Doc): string | null {
  if (doc._id === undefined) return null;
  return JSON.stringify(doc._id);
}
