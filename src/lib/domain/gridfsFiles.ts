import type { Doc } from "./doc";
import { numFromExt, dateIsoFromExt } from "./extjson";

export interface GridfsFileRow {
  /** The raw document, kept for `idJson(row.doc)` when invoking preview/download. */
  doc: Doc;
  filename: string | null;
  length: number | null;
  contentType: string | undefined;
  uploadDateIso: string | null;
}

/** Escapes regex metacharacters so a raw filename search term is matched literally, not as a pattern. */
export function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shapes one raw `<bucket>.files` document (as returned by `queryPage`) into the fields the file
 *  browser panel displays. `metadata.contentType` is a GridFS convention, not a guaranteed field. */
export function toGridfsFileRow(doc: Doc): GridfsFileRow {
  const metadata = doc.metadata as Record<string, unknown> | undefined;
  const contentType =
    metadata && typeof metadata.contentType === "string" ? metadata.contentType : undefined;
  return {
    doc,
    filename: typeof doc.filename === "string" ? doc.filename : null,
    length: numFromExt(doc.length),
    contentType,
    uploadDateIso: dateIsoFromExt(doc.uploadDate),
  };
}
