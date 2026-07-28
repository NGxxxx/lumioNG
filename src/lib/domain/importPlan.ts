/** Pure helpers for the Import Dialog: SQL multi-table target planning, large-file confirm gate. */

export type SqlImportTargetPlan =
  | { kind: "existing"; coll: string }
  | { kind: "new"; collections: string[] };

/** Mirrors sql_import.rs::resolve_target_collection: a non-blank target collection takes every
 *  selected table's rows; a blank one creates one new collection per selected table (named after
 *  the table). The target is always user-editable — see `sqlImport.svelte.ts`'s `targetColl`. */
export function describeSqlImportTargets(
  selected: string[],
  targetColl: string | null,
): SqlImportTargetPlan {
  const trimmed = targetColl?.trim() ?? "";
  if (trimmed !== "") {
    return { kind: "existing", coll: trimmed };
  }
  return { kind: "new", collections: selected };
}

export type ImportTargetPlan =
  | { kind: "existing"; coll: string }
  | { kind: "new"; coll: string }
  | { kind: "unset" };

/** Single-target formats (JSON/JSONL/BSON/CSV): blank means no target chosen yet ("unset", no
 *  notice to show); a name matching an existing collection writes into it; any other non-blank
 *  name creates a new collection. Mirrors describeSqlImportTargets' existing/new split, but for
 *  exactly one target instead of a multi-table plan. */
export function describeImportTarget(
  targetColl: string,
  existingCollections: string[],
): ImportTargetPlan {
  const trimmed = targetColl.trim();
  if (trimmed === "") return { kind: "unset" };
  return existingCollections.includes(trimmed)
    ? { kind: "existing", coll: trimmed }
    : { kind: "new", coll: trimmed };
}

/** Not user-configurable (see the parent design spec) — a coarse gate before any import path
 *  starts parsing, not a RAM-usage guarantee. */
export const LARGE_IMPORT_FILE_BYTES = 200 * 1024 * 1024;

export function isLargeImportFile(bytes: number): boolean {
  return bytes > LARGE_IMPORT_FILE_BYTES;
}

/** MB, one decimal place — first byte-size display in this codebase, no existing convention to
 *  match. */
export function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
