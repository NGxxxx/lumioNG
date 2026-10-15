/** Pure helpers for the per-collection filter history (dedupe, cap, pin ordering). */

export type FilterHistoryEntry = { text: string; at: number; pinned: boolean };

/** Max number of unpinned entries kept. */
const MAX_UNPINNED = 10;

/** Remove insignificant whitespace (everything outside string literals). */
export function normalizeFilter(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (!/\s/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

/** Record an applied filter: newest first, deduped by normalized text (pin kept), pinned never evicted, at most 10 unpinned. Empty / `{}` filters leave the list unchanged. */
export function pushFilter(
  list: FilterHistoryEntry[],
  text: string,
  at: number,
): FilterHistoryEntry[] {
  const norm = normalizeFilter(text);
  if (norm === "" || norm === "{}") return list;
  const existing = list.find((e) => normalizeFilter(e.text) === norm);
  const entry: FilterHistoryEntry = { text: text.trim(), at, pinned: existing?.pinned ?? false };
  const rest = list.filter((e) => e !== existing);
  let unpinned = entry.pinned ? 0 : 1;
  const kept = rest.filter((e) => {
    if (e.pinned) return true;
    unpinned++;
    return unpinned <= MAX_UNPINNED;
  });
  return [entry, ...kept];
}
