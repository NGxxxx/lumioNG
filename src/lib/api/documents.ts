import { invoke, Channel } from "@tauri-apps/api/core";
import type { Doc } from "../domain/doc";

/** Returns documents parsed from Canonical Extended JSON strings; paginated via skip/limit, empty `sort` defaults to {_id:1}. */
export async function queryPage(
  sessionId: string,
  db: string,
  coll: string,
  skip: number,
  limit = 50,
  filter = "{}",
  sort: string | null = null,
  projection: string | null = null,
  timeoutMs: number | null = null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("query_page", {
    sessionId,
    db,
    coll,
    skip,
    limit,
    filter,
    sort,
    projection,
    timeoutMs,
  });
  return rows.map((s) => JSON.parse(s) as Doc);
}

export async function insertDocument(sessionId: string, db: string, coll: string, docJson: string): Promise<string> {
  return await invoke<string>("insert_document", { sessionId, db, coll, docJson });
}

export async function replaceDocument(
  sessionId: string,
  db: string,
  coll: string,
  idJson: string,
  docJson: string,
): Promise<void> {
  await invoke("replace_document", { sessionId, db, coll, idJson, docJson });
}

export async function deleteDocument(sessionId: string, db: string, coll: string, idJson: string): Promise<void> {
  await invoke("delete_document", { sessionId, db, coll, idJson });
}

/** Fetches the full document by _id (no projection) — safe for edit/replace. */
export async function fetchFullDoc(sessionId: string, db: string, coll: string, idJson: string): Promise<Doc | null> {
  const rows = await invoke<string[]>("query_page", {
    sessionId,
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
  sessionId: string,
  db: string,
  coll: string,
  filter = "{}",
  size = 100,
  timeoutMs: number | null = null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("sample_documents", { sessionId, db, coll, filter, size, timeoutMs });
  return rows.map((s) => JSON.parse(s) as Doc);
}

/** Counts documents matching the filter (Canonical ExtJSON). */
export async function countDocuments(
  sessionId: string,
  db: string,
  coll: string,
  filter = "{}",
  timeoutMs: number | null = null,
): Promise<number> {
  return await invoke<number>("count_documents", { sessionId, db, coll, filter, timeoutMs });
}

/** Distinct values for a field (Canonical ExtJSON parsed). filter defaults to {}. */
export async function distinct(
  sessionId: string,
  db: string,
  coll: string,
  field: string,
  filter = "{}",
  timeoutMs: number | null = null,
): Promise<unknown[]> {
  const rows = await invoke<string[]>("distinct", { sessionId, db, coll, field, filter, timeoutMs });
  return rows.map((s) => JSON.parse(s) as unknown);
}

/** Updates many documents by filter; `allowAll=true` required to allow an empty filter. Returns matched/modified counts. */
export async function updateMany(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  update: string,
  allowAll: boolean,
): Promise<{ matched: number; modified: number }> {
  return await invoke<{ matched: number; modified: number }>("update_many", {
    sessionId,
    db,
    coll,
    filter,
    update,
    allowAll,
  });
}

/** Deletes many documents by filter; `allowAll=true` required to allow an empty filter. Returns deleted count. */
export async function deleteMany(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  allowAll: boolean,
): Promise<number> {
  return await invoke<number>("delete_many", { sessionId, db, coll, filter, allowAll });
}

/** Insert multiple documents (ExtJSON array string). Returns count + parsed inserted ids. */
export async function insertMany(
  sessionId: string,
  db: string,
  coll: string,
  docsJson: string,
): Promise<{ insertedCount: number; insertedIds: unknown[] }> {
  const res = await invoke<{ insertedCount: number; insertedIds: string[] }>("insert_many", {
    sessionId,
    db,
    coll,
    docsJson,
  });
  return { insertedCount: res.insertedCount, insertedIds: res.insertedIds.map((s) => JSON.parse(s) as unknown) };
}

/** Updates a single document by filter; `allowAll=true` required for an empty filter. Returns matched/modified. */
export async function updateOne(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  update: string,
  allowAll: boolean,
): Promise<{ matched: number; modified: number }> {
  return await invoke<{ matched: number; modified: number }>("update_one", {
    sessionId,
    db,
    coll,
    filter,
    update,
    allowAll,
  });
}

/** Replaces a single document by filter; `allowAll=true` required for an empty filter. Returns matched/modified. */
export async function replaceOne(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  replacement: string,
  allowAll: boolean,
): Promise<{ matched: number; modified: number }> {
  return await invoke<{ matched: number; modified: number }>("replace_one", {
    sessionId,
    db,
    coll,
    filter,
    replacement,
    allowAll,
  });
}

/** Deletes a single document by filter; `allowAll=true` required for an empty filter. Returns deleted count. */
export async function deleteOne(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  allowAll: boolean,
): Promise<number> {
  return await invoke<number>("delete_one", { sessionId, db, coll, filter, allowAll });
}

type ProgressCb = (done: number, total: number) => void;

function progressChannel(onProgress: ProgressCb): Channel<{ done: number; total: number }> {
  const ch = new Channel<{ done: number; total: number }>();
  ch.onmessage = (m) => onProgress(m.done, m.total);
  return ch;
}

/** Stream a collection to a JSON array file in the backend. Returns the document count. */
export async function exportJsonProgress(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  path: string,
  onProgress: ProgressCb,
): Promise<number> {
  return await invoke<number>("export_json_progress", {
    sessionId, db, coll, filter, sort, projection, path, onProgress: progressChannel(onProgress),
  });
}

/** Stream a collection to a concatenated-BSON file in the backend. Returns the document count. */
export async function exportBsonProgress(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  path: string,
  onProgress: ProgressCb,
): Promise<number> {
  return await invoke<number>("export_bson_progress", {
    sessionId, db, coll, filter, sort, projection, path, onProgress: progressChannel(onProgress),
  });
}

/** Fetch all matching docs as parsed ExtJSON (CSV path); reports progress while reading. */
export async function exportQueryProgress(
  sessionId: string,
  db: string,
  coll: string,
  filter: string,
  sort: string | null,
  projection: string | null,
  onProgress: ProgressCb,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("export_query_progress", {
    sessionId, db, coll, filter, sort, projection, onProgress: progressChannel(onProgress),
  });
  return rows.map((s) => JSON.parse(s) as Doc);
}

export interface ImportResult {
  inserted: number;
  failed: number;
  errors: string[];
}

/** Reads a file (JSON array or JSONL) and inserts via insert_many(ordered=false); reports progress. */
export async function importDocuments(
  sessionId: string,
  db: string,
  coll: string,
  path: string,
  onProgress: ProgressCb,
): Promise<ImportResult> {
  return await invoke<ImportResult>("import_documents", {
    sessionId, db, coll, path, onProgress: progressChannel(onProgress),
  });
}

/** Import a concatenated-BSON (.bson) file via insert_many(ordered=false); reports progress. */
export async function importBson(
  sessionId: string,
  db: string,
  coll: string,
  path: string,
  onProgress: ProgressCb,
): Promise<ImportResult> {
  return await invoke<ImportResult>("import_bson", {
    sessionId, db, coll, path, onProgress: progressChannel(onProgress),
  });
}

/** Run an aggregate pipeline (ExtJSON array string). skip/limit append trailing $skip/$limit stages. */
export async function aggregate(
  sessionId: string,
  db: string,
  coll: string,
  pipeline: string,
  skip: number | null,
  limit: number | null,
  timeoutMs: number | null = null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("aggregate", { sessionId, db, coll, pipeline, skip, limit, timeoutMs });
  return rows.map((s) => JSON.parse(s) as Doc);
}

/** Counts documents an aggregate pipeline would produce (appends a $count stage). */
export async function aggregateCount(
  sessionId: string,
  db: string,
  coll: string,
  pipeline: string,
  timeoutMs: number | null = null,
): Promise<number> {
  return await invoke<number>("aggregate_count", { sessionId, db, coll, pipeline, timeoutMs });
}

/** Runs `explain` (verbosity "executionStats") for a pure find/aggregate cursor recipe; returns the raw Canonical ExtJSON reply, unparsed (see `domain/explainPlan.ts`). */
export async function explainQuery(
  sessionId: string,
  cursorKind: "find" | "agg",
  db: string,
  coll: string,
  query: string,
  sort: string | null,
  projection: string | null,
  skip: number,
  limit: number | null,
  timeoutMs: number | null = null,
): Promise<string> {
  return cursorKind === "agg"
    ? await invoke<string>("explain_aggregate", { sessionId, db, coll, pipeline: query, skip, limit, timeoutMs })
    : await invoke<string>("explain_find", { sessionId, db, coll, filter: query, sort, projection, skip, limit, timeoutMs });
}
