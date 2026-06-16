import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "./columns";

export interface DbInfo {
  name: string;
  collections: string[];
}

export interface AppErrorShape {
  kind: "Connection" | "Query" | "Serialize" | "Parse" | "NotConnected";
  message?: string;
}

export async function connect(uri: string): Promise<void> {
  await invoke("connect", { uri });
}

export async function listNamespaces(): Promise<DbInfo[]> {
  return await invoke<DbInfo[]>("list_namespaces");
}

/** Returns documents parsed from Canonical Extended JSON strings. */
export async function queryPage(
  db: string,
  coll: string,
  afterId: string | null,
  limit = 50
): Promise<Doc[]> {
  const rows = await invoke<string[]>("query_page", { db, coll, afterId, limit });
  return rows.map((s) => JSON.parse(s) as Doc);
}

/** Extract the _id ($oid) of the last doc for paging; null if none. */
export function lastObjectId(docs: Doc[]): string | null {
  if (docs.length === 0) return null;
  const id = docs[docs.length - 1]._id as { $oid?: string } | undefined;
  return id?.$oid ?? null;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "kind" in e) {
    const err = e as AppErrorShape;
    return err.message ? `${err.kind}: ${err.message}` : err.kind;
  }
  return String(e);
}

export async function insertDocument(
  db: string,
  coll: string,
  docJson: string
): Promise<string> {
  return await invoke<string>("insert_document", { db, coll, docJson });
}

export async function replaceDocument(
  db: string,
  coll: string,
  idJson: string,
  docJson: string
): Promise<void> {
  await invoke("replace_document", { db, coll, idJson, docJson });
}

export async function deleteDocument(
  db: string,
  coll: string,
  idJson: string
): Promise<void> {
  await invoke("delete_document", { db, coll, idJson });
}

/** Serialize a document's _id back to a Canonical Extended JSON string; null if absent. */
export function idJson(doc: Doc): string | null {
  if (doc._id === undefined) return null;
  return JSON.stringify(doc._id);
}
