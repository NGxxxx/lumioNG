/** Pure helpers for the Import Dialog: SQL multi-table target planning, large-file confirm gate. */

export type SqlImportTargetPlan =
  | { kind: "existing"; coll: string }
  | { kind: "new"; collections: string[] };

/** Mirrors sql_import.rs::resolve_target_collection: a single-table dump with a pre-selected
 *  coll always lands there regardless of selection; anything else creates one new collection per
 *  currently selected table name. `totalTables` is the whole dump's table count (not the
 *  selection size) — matches resolve_target_collection's is_single_table_dump check. */
export function describeSqlImportTargets(
  totalTables: number,
  selected: string[],
  targetColl: string | null,
): SqlImportTargetPlan {
  if (totalTables === 1 && targetColl !== null) {
    return { kind: "existing", coll: targetColl };
  }
  return { kind: "new", collections: selected };
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
