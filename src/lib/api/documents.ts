import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "../domain/columns";

/** Returns documents parsed from Canonical Extended JSON strings. */
export async function queryPage(
  db: string,
  coll: string,
  afterId: string | null,
  limit = 50,
  filter = "{}",
): Promise<Doc[]> {
  const rows = await invoke<string[]>("query_page", { db, coll, afterId, limit, filter });
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
