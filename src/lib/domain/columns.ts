export type Doc = Record<string, unknown>;

/**
 * Union key cấp 1 từ danh sách document đã fetch.
 * `_id` luôn là cột đầu; các key còn lại theo thứ tự xuất hiện lần đầu.
 */
export function deriveColumnKeys(docs: Doc[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  if (seen.has("_id")) {
    return ["_id", ...keys.filter((k) => k !== "_id")];
  }
  return keys;
}
