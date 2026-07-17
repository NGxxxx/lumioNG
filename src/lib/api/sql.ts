import { invoke, Channel } from "@tauri-apps/api/core";

export interface SqlTablePreview {
  table: string;
  columns: string[];
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

/**
 * Re-parses the dump and inserts the selected tables' rows. When the dump has exactly one table
 * and `targetColl` is set (the dialog was opened from a specific collection), that table's rows go
 * into `targetColl` instead of a new collection named after the table; multi-table dumps always
 * create one collection per table regardless of `targetColl`.
 */
export async function sqlImportCommit(
  sessionId: string,
  db: string,
  path: string,
  tables: string[],
  targetColl: string | null,
  onProgress: (table: string, done: number, total: number) => void,
): Promise<SqlImportTableResult[]> {
  const ch = new Channel<{ table: string; done: number; total: number }>();
  ch.onmessage = (m) => onProgress(m.table, m.done, m.total);
  return await invoke<SqlImportTableResult[]>("sql_import_commit", {
    sessionId, db, path, tables, targetColl, onProgress: ch,
  });
}
