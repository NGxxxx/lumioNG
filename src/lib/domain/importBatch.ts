/** Pure planning for importing several files at once (multi-select, or a whole folder such as a
 *  `mongodump` database directory): one collection per file, named after the file. */
import { validateCollectionName } from "./namespaces";

export type ImportFormat = "json" | "jsonl" | "bson" | "csv" | "sql";

/** The file's extension decides the import flow; anything unrecognised is read as JSON. */
export function importFormatOf(path: string): ImportFormat {
  const p = path.toLowerCase();
  return p.endsWith(".sql") ? "sql" : p.endsWith(".csv") ? "csv" : p.endsWith(".bson") ? "bson" : p.endsWith(".jsonl") ? "jsonl" : "json";
}

export function fileNameOf(path: string): string {
  return path.replace(/^.*[\\/]/, "");
}

const BATCH_EXT = /\.(jsonl|json|bson|csv)$/i;

/** `orders.bson` → `orders`, `logs.2024.jsonl` → `logs.2024` (only the format extension goes). */
export function collectionNameFromFile(path: string): string {
  return fileNameOf(path).replace(BATCH_EXT, "");
}

/** Why a picked file is left out: an SQL dump (its own table picker), a `.metadata.json` sidecar
 *  (applied with its data file) or an unknown extension. */
export type BatchSkip = "sql" | "metadata" | "unsupported";

export type BatchPlanEntry = {
  path: string;
  fileName: string;
  format: ImportFormat;
  /** Target collection, editable by the user. */
  coll: string;
  skip: BatchSkip | null;
};

/** One entry per picked file: the importable ones first, then the skipped ones (sidecars, SQL,
 *  unknown files — kept so the user sees why they won't be imported), each group in name order. */
export function planImportBatch(paths: string[]): BatchPlanEntry[] {
  return [...paths]
    .sort((a, b) => fileNameOf(a).localeCompare(fileNameOf(b)))
    .map((path): BatchPlanEntry => {
      const fileName = fileNameOf(path);
      const lower = fileName.toLowerCase();
      const format = importFormatOf(path);
      // mongodump writes `<coll>.metadata.json` per collection and one `prelude.json` (dump info).
      const skip: BatchSkip | null = lower.endsWith(".metadata.json") || lower === "prelude.json" ? "metadata"
        : format === "sql" ? "sql"
        : BATCH_EXT.test(lower) ? null
        : "unsupported";
      return { path, fileName, format, coll: skip ? "" : collectionNameFromFile(path), skip };
    })
    .sort((a, b) => Number(a.skip !== null) - Number(b.skip !== null));
}

/** Per entry: a collection-name error key, `"err_coll_name_duplicate"` when two files would write
 *  into the same collection, or null. Skipped entries never have an error. */
export function batchTargetErrors(entries: { coll: string; skip: BatchSkip | null }[]): (string | null)[] {
  const counts = new Map<string, number>();
  for (const e of entries) if (!e.skip) counts.set(e.coll.trim(), (counts.get(e.coll.trim()) ?? 0) + 1);
  return entries.map((e) => {
    if (e.skip) return null;
    const name = e.coll.trim();
    return validateCollectionName(name) ?? ((counts.get(name) ?? 0) > 1 ? "err_coll_name_duplicate" : null);
  });
}
