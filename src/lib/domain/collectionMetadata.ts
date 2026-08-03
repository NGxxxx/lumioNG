/** Pure helpers for the collection metadata sidecar (indexes + validator/options) written alongside
 *  an exported data file and restored alongside a matching import. */

/** `<dir>/<name>.<ext>` -> `<dir>/<name>.metadata.json`, regardless of the data format's extension. */
export function metadataPathFor(dataFilePath: string): string {
  const slash = Math.max(dataFilePath.lastIndexOf("/"), dataFilePath.lastIndexOf("\\"));
  const dot = dataFilePath.lastIndexOf(".");
  const base = dot > slash ? dataFilePath.slice(0, dot) : dataFilePath;
  return `${base}.metadata.json`;
}

/** Bundles `listIndexes` output (raw ExtJSON index docs) and a `listCollections` entry (raw ExtJSON,
 *  as returned by `coll_options`) into one pretty-printed sidecar document. */
export function buildMetadataBundle(indexes: string[], collOptionsJson: string): string {
  const bundle = {
    indexes: indexes.map((s) => JSON.parse(s)),
    options: JSON.parse(collOptionsJson),
  };
  return JSON.stringify(bundle, null, 2);
}

export interface ParsedMetadataBundle {
  /** ExtJSON array text of the index docs, ready for `createIndexesRaw`. */
  indexesJson: string;
  /** ExtJSON object text of the validator, or null when the collection had none. */
  validatorJson: string | null;
  validationLevel: string;
  validationAction: string;
}

/** Inverse of `buildMetadataBundle`; returns null for unreadable/malformed sidecar content
 *  (treated as "no metadata to restore" rather than an import-blocking error). */
export function parseMetadataBundle(bundleJson: string): ParsedMetadataBundle | null {
  let bundle: { indexes?: unknown; options?: { options?: Record<string, unknown> } };
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    return null;
  }
  if (!Array.isArray(bundle.indexes)) return null;
  const opts = bundle.options?.options;
  const validator = opts?.validator;
  return {
    indexesJson: JSON.stringify(bundle.indexes),
    validatorJson: validator !== undefined ? JSON.stringify(validator) : null,
    validationLevel: typeof opts?.validationLevel === "string" ? opts.validationLevel : "strict",
    validationAction: typeof opts?.validationAction === "string" ? opts.validationAction : "error",
  };
}
