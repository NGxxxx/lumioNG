import { invoke, Channel } from "@tauri-apps/api/core";
import type { Doc } from "../domain/doc";

/**
 * Returns documents parsed from Canonical Extended JSON strings.
 * Pagination via skip/limit: `skip` = docs to skip (computed by the frontend from page). Empty `sort` defaults to {_id:1}.
 */
export async function queryPage(
  db: string,
  coll: string,
  skip: number,
  limit = 50,
  filter = "{}",
  sort: string | null = null,
  projection: string | null = null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("query_page", {
    db,
    coll,
    skip,
    limit,
    filter,
    sort,
    projection,
  });
  return rows.map((s) => JSON.parse(s) as Doc);
}

export async function insertDocument(db: string, coll: string, docJson: string): Promise<string> {
  return await invoke<string>("insert_document", { db, coll, docJson });
}

export async function replaceDocument(
  db: string,
  coll: string,
  idJson: string,
  docJson: string,
): Promise<void> {
  await invoke("replace_document", { db, coll, idJson, docJson });
}

export async function deleteDocument(db: string, coll: string, idJson: string): Promise<void> {
  await invoke("delete_document", { db, coll, idJson });
}

/** Fetches the full document by _id (no projection) — safe for edit/replace. */
export async function fetchFullDoc(db: string, coll: string, idJson: string): Promise<Doc | null> {
  const rows = await invoke<string[]>("query_page", {
    db,
    coll,
    skip: 0,
    limit: 1,
    filter: `{"_id": ${idJson}}`,
    sort: null,
    projection: null,
  });
  return rows.length ? (JSON.parse(rows[0]) as Doc) : null;
}

/** Returns `size` random documents for schema sampling (filter applied if provided). */
export async function sampleDocuments(
  db: string,
  coll: string,
  filter = "{}",
  size = 100,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("sample_documents", { db, coll, filter, size });
  return rows.map((s) => JSON.parse(s) as Doc);
}

/** Counts documents matching the filter (Canonical ExtJSON). */
export async function countDocuments(db: string, coll: string, filter = "{}"): Promise<number> {
  return await invoke<number>("count_documents", { db, coll, filter });
}

/** Updates many documents by filter; `allowAll=true` required to allow an empty filter. Returns matched/modified counts. */
export async function updateMany(
  db: string,
  coll: string,
  filter: string,
  update: string,
  allowAll: boolean,
): Promise<{ matched: number; modified: number }> {
  return await invoke<{ matched: number; modified: number }>("update_many", {
    db,
    coll,
    filter,
    update,
    allowAll,
  });
}

/** Deletes many documents by filter; `allowAll=true` required to allow an empty filter. Returns deleted count. */
export async function deleteMany(
  db: string,
  coll: string,
  filter: string,
  allowAll: boolean,
): Promise<number> {
  return await invoke<number>("delete_many", { db, coll, filter, allowAll });
}

type ProgressCb = (done: number, total: number) => void;

function progressChannel(onProgress: ProgressCb): Channel<{ done: number; total: number }> {
  const ch = new Channel<{ done: number; total: number }>();
  ch.onmessage = (m) => onProgress(m.done, m.total);
  return ch;
}

/** Stream a collection to a JSON array file in the backend. Returns the document count. */
export async function exportJsonProgress(
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  path: string,
  onProgress: ProgressCb,
): Promise<number> {
  return await invoke<number>("export_json_progress", {
    db, coll, filter, sort, projection, path, onProgress: progressChannel(onProgress),
  });
}

/** Stream a collection to a concatenated-BSON file in the backend. Returns the document count. */
export async function exportBsonProgress(
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  path: string,
  onProgress: ProgressCb,
): Promise<number> {
  return await invoke<number>("export_bson_progress", {
    db, coll, filter, sort, projection, path, onProgress: progressChannel(onProgress),
  });
}

/** Fetch all matching docs as parsed ExtJSON (CSV path); reports progress while reading. */
export async function exportQueryProgress(
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  onProgress: ProgressCb,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("export_query_progress", {
    db, coll, filter, sort, projection, onProgress: progressChannel(onProgress),
  });
  return rows.map((s) => JSON.parse(s) as Doc);
}

export interface ImportResult {
  inserted: number;
  failed: number;
  errors: string[];
}

/** Reads a file (JSON array or JSONL) and inserts via insert_many(ordered=false). */
export async function importDocuments(
  db: string,
  coll: string,
  path: string,
): Promise<ImportResult> {
  return await invoke<ImportResult>("import_documents", { db, coll, path });
}

/** Import a concatenated-BSON (.bson) file via insert_many(ordered=false). */
export async function importBson(db: string, coll: string, path: string): Promise<ImportResult> {
  return await invoke<ImportResult>("import_bson", { db, coll, path });
}

/** Run an aggregate pipeline (ExtJSON array string). limit≠null appends a trailing $limit. */
export async function aggregate(
  db: string,
  coll: string,
  pipeline: string,
  limit: number | null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("aggregate", { db, coll, pipeline, limit });
  return rows.map((s) => JSON.parse(s) as Doc);
}
