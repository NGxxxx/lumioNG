export type PreviewKind = "image" | "pdf" | "text" | "unknown";

/** Server-side mirror: `PREVIEW_CAP_BYTES` in `src-tauri/src/commands/gridfs.rs`. Keep both in
 *  sync -- this is what actually gates the preview network call; the backend cap is defense in
 *  depth on top of it. */
export const GRIDFS_PREVIEW_CAP_BYTES = 5 * 1024 * 1024;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const TEXT_EXT = new Set(["txt", "md", "json", "csv", "log", "xml", "yaml", "yml"]);

const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** Best-effort preview classification: prefers a MIME-shaped `metadata.contentType` (a GridFS
 *  convention, not a guaranteed field -- the modern GridFS spec dropped the top-level
 *  `contentType` field the driver used to expose), falls back to the filename extension,
 *  "unknown" when neither resolves. */
export function classifyPreviewKind(filename: string | null, contentType: string | undefined): PreviewKind {
  const ct = contentType?.toLowerCase();
  if (ct?.includes("/")) {
    if (ct.startsWith("image/")) return "image";
    if (ct === "application/pdf") return "pdf";
    if (ct.startsWith("text/") || ct === "application/json") return "text";
  }
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext) {
    if (IMAGE_EXT.has(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (TEXT_EXT.has(ext)) return "text";
  }
  return "unknown";
}

/** Decodes a base64-encoded byte string as UTF-8 text (not the Latin-1 semantics of a bare `atob()`). */
export function base64ToUtf8Text(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Resolves a concrete image MIME type for a data URL -- `image/*` isn't valid there (browsers
 *  sniff raster formats but select SVG strictly by declared MIME type, so `image/*` silently fails
 *  to render SVGs). Prefers an already MIME-shaped `contentType`, falls back to the filename
 *  extension, then `application/octet-stream` as a last resort (not expected to be reachable when
 *  the caller has already classified the file as `"image"`). */
export function imageMimeType(filename: string | null, contentType: string | undefined): string {
  const ct = contentType?.toLowerCase();
  if (ct?.startsWith("image/")) return ct;
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext && ext in IMAGE_EXT_MIME) return IMAGE_EXT_MIME[ext];
  return "application/octet-stream";
}
