/** Naming-convention-only GridFS bucket-pair detection (no schema/index checks) -- a collection
 *  named `<prefix>.files` is treated as a GridFS bucket's file list only when its sibling
 *  `<prefix>.chunks` is also present in the same database. */
export function detectGridFsBucket(collections: string[], collName: string): string | null {
  const suffix = ".files";
  if (!collName.endsWith(suffix)) return null;
  const prefix = collName.slice(0, -suffix.length);
  if (prefix.length === 0) return null;
  return collections.includes(`${prefix}.chunks`) ? prefix : null;
}
