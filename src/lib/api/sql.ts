import { invoke, Channel } from "@tauri-apps/api/core";
import type { InsertMode } from "./documents";

export interface SqlColumnPreview {
  name: string;
  inferredType: string;
}

export interface SqlTablePreview {
  table: string;
  columns: SqlColumnPreview[];
  rowCount: number;
}

/** Parses a SQL dump (CREATE TABLE + INSERT INTO only) and lists what's in it, without writing anything. */
export async function sqlImportPreview(path: string): Promise<SqlTablePreview[]> {
  return await invoke<SqlTablePreview[]>("sql_import_preview", { path });
}

export interface SqlImportTableResult {
  table: string;
  inserted: number;
  failed: number;
  errors: string[];
}

export interface SqlImportCommitResult {
  tables: SqlImportTableResult[];
  /** `true` if this is a partial result from a user-requested cancel, not full completion. */
  cancelled: boolean;
}

/** Re-parses the dump and inserts the selected tables' rows; a single-table dump with `targetColl` set goes there instead of a new collection. */
export async function sqlImportCommit(
  sessionId: string,
  db: string,
  path: string,
  tables: string[],
  targetColl: string | null,
  insertMode: InsertMode,
  onProgress: (table: string, done: number, total: number) => void,
): Promise<SqlImportCommitResult> {
  const ch = new Channel<{ table: string; done: number; total: number }>();
  ch.onmessage = (m) => onProgress(m.table, m.done, m.total);
  return await invoke<SqlImportCommitResult>("sql_import_commit", {
    sessionId, db, path, tables, targetColl, insertMode, onProgress: ch,
  });
}

/** Requests cancellation of the SQL import currently in flight on this session. */
export async function cancelSqlImport(sessionId: string): Promise<void> {
  await invoke("cancel_import", { sessionId });
}
