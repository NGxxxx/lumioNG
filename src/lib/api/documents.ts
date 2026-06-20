import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../domain/columns";

/**
 * Con trỏ phân trang: keyset trên _id (pristine) HOẶC skip/limit (đã filter/sort).
 * `afterId` = chuỗi Canonical Extended JSON của `_id` doc cuối (mọi kiểu: `{"$oid":...}`,
 * `"abc"`, `{"$numberInt":"5"}`); `null` cho trang đầu.
 */
export type Cursor = { afterId: string | null } | { skip: number };

/**
 * Returns documents parsed from Canonical Extended JSON strings.
 * Keyset mode (`afterId`): backend dùng `_id > afterId`, KHÔNG nhận sort.
 * `afterId` phải là chuỗi Canonical Extended JSON của `_id`.
 */
export async function queryPage(
  db: string,
  coll: string,
  cursor: Cursor,
  limit = 50,
  filter = "{}",
  sort: string | null = null,
  projection: string | null = null,
): Promise<Doc[]> {
  const afterId = "afterId" in cursor ? cursor.afterId : null;
  const skip = "skip" in cursor ? cursor.skip : null;
  const rows = await invoke<string[]>("query_page", {
    db,
    coll,
    afterId,
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

/** Lấy lại nguyên doc theo _id (không projection) — full doc để edit/replace an toàn. */
export async function fetchFullDoc(db: string, coll: string, idJson: string): Promise<Doc | null> {
  const rows = await invoke<string[]>("query_page", {
    db,
    coll,
    afterId: null,
    skip: 0,
    limit: 1,
    filter: `{"_id": ${idJson}}`,
    sort: null,
    projection: null,
  });
  return rows.length ? (JSON.parse(rows[0]) as Doc) : null;
}

/** Mẫu schema: trả về `size` document ngẫu nhiên (áp filter nếu có). */
export async function sampleDocuments(
  db: string,
  coll: string,
  filter = "{}",
  size = 100,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("sample_documents", { db, coll, filter, size });
  return rows.map((s) => JSON.parse(s) as Doc);
}

/** Đếm số document khớp filter (ExtJSON). */
export async function countDocuments(db: string, coll: string, filter = "{}"): Promise<number> {
  return await invoke<number>("count_documents", { db, coll, filter });
}

/** updateMany theo filter; allowAll=true mới cho phép filter rỗng. Trả số matched/modified. */
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

/** deleteMany theo filter; allowAll=true mới cho phép filter rỗng. Trả số deleted. */
export async function deleteMany(
  db: string,
  coll: string,
  filter: string,
  allowAll: boolean,
): Promise<number> {
  return await invoke<number>("delete_many", { db, coll, filter, allowAll });
}

/** Toàn bộ doc khớp filter (kèm sort/projection đang áp) — KHÔNG phân trang. */
export async function exportQuery(
  db: string,
  coll: string,
  filter = "{}",
  sort: string | null = null,
  projection: string | null = null,
): Promise<Doc[]> {
  const rows = await invoke<string[]>("export_query", { db, coll, filter, sort, projection });
  return rows.map((s) => JSON.parse(s) as Doc);
}

export interface ImportResult {
  inserted: number;
  failed: number;
  errors: string[];
}

/** Đọc file (mảng JSON hoặc JSONL) → insert_many(ordered=false). */
export async function importDocuments(
  db: string,
  coll: string,
  path: string,
): Promise<ImportResult> {
  return await invoke<ImportResult>("import_documents", { db, coll, path });
}
