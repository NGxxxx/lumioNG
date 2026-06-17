import type { Doc } from "./columns";

/** Extract the _id ($oid) of the last doc for paging; null if none. */
export function lastObjectId(docs: Doc[]): string | null {
  if (docs.length === 0) return null;
  const id = docs[docs.length - 1]._id as { $oid?: string } | undefined;
  return id?.$oid ?? null;
}

/** Serialize a document's _id back to a Canonical Extended JSON string; null if absent. */
export function idJson(doc: Doc): string | null {
  if (doc._id === undefined) return null;
  return JSON.stringify(doc._id);
}
