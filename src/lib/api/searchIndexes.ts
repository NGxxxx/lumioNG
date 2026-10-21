import { invoke } from "@tauri-apps/api/core";

/** The Atlas version when the server answers `atlasVersion`, else null (never throws for "not Atlas"). */
export async function atlasVersion(sessionId: string): Promise<string | null> {
  return await invoke<string | null>("atlas_version", { sessionId });
}

/** `$listSearchIndexes` documents as canonical ExtJSON strings. */
export async function listSearchIndexes(sessionId: string, db: string, coll: string): Promise<string[]> {
  return await invoke<string[]>("list_search_indexes", { sessionId, db, coll });
}

/** Creates a search index (`indexType` "search" | "vectorSearch") and returns its name. */
export async function createSearchIndex(
  sessionId: string, db: string, coll: string, name: string | null, indexType: string | null, definition: string,
): Promise<string> {
  return await invoke<string>("create_search_index", { sessionId, db, coll, name, indexType, definition });
}

export async function updateSearchIndex(sessionId: string, db: string, coll: string, name: string, definition: string): Promise<void> {
  await invoke("update_search_index", { sessionId, db, coll, name, definition });
}

export async function dropSearchIndex(sessionId: string, db: string, coll: string, name: string): Promise<void> {
  await invoke("drop_search_index", { sessionId, db, coll, name });
}
