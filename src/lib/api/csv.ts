import { invoke, Channel } from "@tauri-apps/api/core";
import type { ImportResult, InsertMode } from "./documents";

export type CsvDelimiter = "comma" | "semicolon" | "tab";

export interface CsvColumnPreview {
  path: string;
  inferredType: string;
  samples: string[];
}

export interface CsvInferOptions {
  parseJsonLike: boolean;
  inferScalars: boolean;
}

/** Reads the header + first ~30 data rows to report columns, inferred type, and samples — never scans the whole file. */
export async function csvImportPreview(
  path: string,
  delimiter: CsvDelimiter,
  inferOpts: CsvInferOptions,
): Promise<CsvColumnPreview[]> {
  return await invoke<CsvColumnPreview[]>("csv_import_preview", { path, delimiter, inferOpts });
}

/** Streams the file, rebuilds dotted headers into nested documents, and inserts in bounded-size batches. */
export async function csvImportCommit(
  sessionId: string,
  db: string,
  coll: string,
  path: string,
  delimiter: CsvDelimiter,
  inferOpts: CsvInferOptions,
  insertMode: InsertMode,
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const ch = new Channel<{ done: number; total: number }>();
  ch.onmessage = (m) => onProgress(m.done, m.total);
  return await invoke<ImportResult>("csv_import_commit", {
    sessionId, db, coll, path, delimiter, inferOpts, insertMode, onProgress: ch,
  });
}
