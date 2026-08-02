/** Naming-convention-only GridFS bucket-pair detection (no schema/index checks) -- a collection
 *  named `<prefix>.files` is treated as a GridFS bucket's file list when its sibling
 *  `<prefix>.chunks` is present in the same database, OR (since the MongoDB driver creates
 *  `.chunks` lazily on first chunk write) when `<prefix>.files` itself is known to be empty -- a
 *  genuinely valid but empty/emptied GridFS bucket can have `.files` without `.chunks` yet.
 *  `filesIsEmpty` must be supplied by the caller (this function stays pure/sync, no I/O) after an
 *  actual document-count check; omit it (or pass `false`) when that check hasn't been done, which
 *  preserves the strict/old behavior and avoids false-positives on an arbitrary unrelated
 *  collection that merely happens to be named `X.files` and holds real documents. */
export function detectGridFsBucket(collections: string[], collName: string, filesIsEmpty = false): string | null {
  const suffix = ".files";
  if (!collName.endsWith(suffix)) return null;
  const prefix = collName.slice(0, -suffix.length);
  if (prefix.length === 0) return null;
  if (collections.includes(`${prefix}.chunks`)) return prefix;
  return filesIsEmpty ? prefix : null;
}
