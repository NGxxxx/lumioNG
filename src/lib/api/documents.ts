import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../domain/columns";

/** Con trỏ phân trang: keyset trên _id (pristine) HOẶC skip/limit (đã filter/sort). */
export type Cursor = { afterId: string | null } | { skip: number };

/** Returns documents parsed from Canonical Extended JSON strings. */
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
