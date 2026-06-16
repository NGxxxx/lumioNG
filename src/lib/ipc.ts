import { invoke } from "@tauri-apps/api/core";
import type { Doc } from "./columns";

export interface DbInfo {
  name: string;
  collections: string[];
}

export interface AppErrorShape {
  kind: "Connection" | "Query" | "Serialize" | "NotConnected";
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
