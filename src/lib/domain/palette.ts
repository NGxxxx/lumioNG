// src/lib/domain/palette.ts — pure ranking/grouping for the ⌘K command palette (no Svelte, no Tauri).
import type { HistoryEntry } from "./queryHistory";

/** One row the palette can show. `group` is the section heading; `detail` is muted secondary text. */
export type PaletteItem = {
  id: string;
  group: string;
  label: string;
  detail?: string;
  /** Extra text that matches but is never shown (synonyms, the English name of a localized command…). */
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
};

/** Half-open [start, end) spans of `label` that matched the query — for highlighting. */
export type Range = [number, number];

export type PaletteMatch = { item: PaletteItem; score: number; ranges: Range[] };

export type PaletteGroup = { group: string; matches: PaletteMatch[] };

/**
 * Folds one UTF-16 unit for matching: lower-case, diacritics stripped (so "chay" finds "Chạy"),
 * đ → d. Always returns exactly one unit, which keeps folded indices aligned with the original
 * string so match ranges can be applied to the label as displayed.
 */
function foldChar(c: string): string {
  if (c === "đ" || c === "Đ") return "d";
  const base = c.normalize("NFD").replace(/\p{M}/gu, "");
  return (base.length === 1 ? base : c).toLowerCase();
}

export function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
  return out;
}

const isBoundary = (s: string, i: number) => i === 0 || /[\s./_\-·:()[\]]/.test(s[i - 1]);

/**
 * Scores `text` against `query` (both raw; folded here). Returns null when the query's characters
 * don't all appear in order. Contiguous substring matches beat scattered (subsequence) ones; a match
 * at the start of the text or of a word scores higher; shorter texts win ties.
 */
export function matchText(text: string, query: string): { score: number; ranges: Range[] } | null {
  const q = fold(query.trim());
  if (q === "") return { score: 0, ranges: [] };
  const t = fold(text);

  const idx = t.indexOf(q);
  if (idx !== -1) {
    // Prefer an occurrence that starts a word over the first raw occurrence.
    let at = idx;
    for (let i = idx; i !== -1; i = t.indexOf(q, i + 1)) {
      if (isBoundary(t, i)) { at = i; break; }
    }
    const score = 1000 + (at === 0 ? 300 : isBoundary(t, at) ? 150 : 0) - Math.min(t.length, 200);
    return { score, ranges: [[at, at + q.length]] };
  }

  // Subsequence: greedy left-to-right, merging adjacent hits into ranges.
  const ranges: Range[] = [];
  let ti = 0;
  let bonus = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === " ") continue;
    while (ti < t.length && t[ti] !== ch) ti++;
    if (ti === t.length) return null;
    if (isBoundary(t, ti)) bonus += 20;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === ti) last[1] = ti + 1;
    else ranges.push([ti, ti + 1]);
    ti++;
  }
  const score = 500 + bonus - ranges.length * 25 - Math.min(t.length, 200);
  return { score, ranges };
}

/**
 * Added to the score of "recent"-group items. Score tiers differ by 150 (word-start vs mid-word,
 * prefix vs word-start) and ~500 (substring vs subsequence), while label length breaks ties by up to
 * ~200. 120 lifts a recent item over an equally-matching one (even a few dozen chars longer) but
 * never over a match one tier better.
 */
export const RECENT_BOOST = 120;

/**
 * Ranks enabled items against `query`. The label is matched first (with highlight ranges); `detail`
 * and `keywords` can still surface an item, at a lower score and without highlights. An empty query
 * keeps the items' own order.
 */
export function filterPalette(items: PaletteItem[], query: string, limit = 60): PaletteMatch[] {
  const enabled = items.filter((it) => !it.disabled);
  if (query.trim() === "") return enabled.slice(0, limit).map((item) => ({ item, score: 0, ranges: [] }));

  const boost = (it: PaletteItem) => (it.id.startsWith("recent:") ? RECENT_BOOST : 0);
  const out: { m: PaletteMatch; i: number }[] = [];
  enabled.forEach((item, i) => {
    const onLabel = matchText(item.label, query);
    if (onLabel) {
      out.push({ m: { item, score: onLabel.score + boost(item), ranges: onLabel.ranges }, i });
      return;
    }
    const extra = [item.detail, item.keywords].filter(Boolean).join(" ");
    const onExtra = extra ? matchText(extra, query) : null;
    if (onExtra) out.push({ m: { item, score: onExtra.score - 400 + boost(item), ranges: [] }, i });
  });
  out.sort((a, b) => b.m.score - a.m.score || a.i - b.i);
  return out.slice(0, limit).map((x) => x.m);
}

/** Buckets ranked matches into sections, ordered by each section's first (best) match. */
export function groupMatches(matches: PaletteMatch[]): PaletteGroup[] {
  const groups: PaletteGroup[] = [];
  const byName = new Map<string, PaletteGroup>();
  for (const m of matches) {
    let g = byName.get(m.item.group);
    if (!g) {
      g = { group: m.item.group, matches: [] };
      byName.set(m.item.group, g);
      groups.push(g);
    }
    g.matches.push(m);
  }
  return groups;
}

/** Splits `label` into plain/highlighted pieces for rendering (ranges must be sorted, non-overlapping). */
export function splitByRanges(label: string, ranges: Range[]): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) parts.push({ text: label.slice(pos, s), hit: false });
    parts.push({ text: label.slice(s, e), hit: true });
    pos = e;
  }
  if (pos < label.length) parts.push({ text: label.slice(pos), hit: false });
  return parts;
}

/** What a namespace palette item points at, decoded from its id. */
export type NamespaceTarget = { db: string; coll: string | null };

const NS_PREFIX = "ns:";

/** Palette items for every database and collection: "db" rows, then "db / coll" rows. */
export function namespacePaletteItems(
  databases: { name: string; collections: string[] }[],
  groups: { databases: string; collections: string },
): PaletteItem[] {
  const dbs: PaletteItem[] = databases.map((d) => ({
    id: NS_PREFIX + JSON.stringify([d.name, null]),
    group: groups.databases,
    label: d.name,
  }));
  const colls: PaletteItem[] = databases.flatMap((d) =>
    d.collections.map((c) => ({
      id: NS_PREFIX + JSON.stringify([d.name, c]),
      group: groups.collections,
      label: c,
      detail: d.name,
      keywords: `${d.name}.${c}`,
    })),
  );
  return [...colls, ...dbs];
}

/** Decodes an id made by `namespacePaletteItems`; null for any other id. */
export function parseNamespaceId(id: string): NamespaceTarget | null {
  if (!id.startsWith(NS_PREFIX)) return null;
  try {
    const v = JSON.parse(id.slice(NS_PREFIX.length));
    if (Array.isArray(v) && typeof v[0] === "string" && (v[1] === null || typeof v[1] === "string")) {
      return { db: v[0], coll: v[1] };
    }
  } catch {
    /* not ours */
  }
  return null;
}

const RECENT_LIMIT = 5;
const RECENT_COLL_PREFIX = "recent:c:";

/** Decodes a "recent collection" id (`recent:c:<connId>/<db>/<coll>`); db names never contain "/",
 *  collection names may contain both "/" and ":". */
export function parseRecentCollectionId(id: string): { db: string; coll: string } | null {
  if (!id.startsWith(RECENT_COLL_PREFIX)) return null;
  const rest = id.slice(RECENT_COLL_PREFIX.length);
  const a = rest.indexOf("/");
  const b = a === -1 ? -1 : rest.indexOf("/", a + 1);
  if (b === -1) return null;
  const db = rest.slice(a + 1, b);
  const coll = rest.slice(b + 1);
  return db && coll ? { db, coll } : null;
}

/** "Recent" palette rows: the last few distinct queries, then the last few opened collections. */
export function recentPaletteItems(
  q: HistoryEntry[],
  colls: { connId: number | null; db: string; coll: string }[],
): PaletteItem[] {
  const out: PaletteItem[] = [];
  const seenQ = new Set<string>();
  for (const e of q) {
    if (out.length >= RECENT_LIMIT) break;
    const k = JSON.stringify([e.db, e.script]);
    if (seenQ.has(k)) continue;
    seenQ.add(k);
    const first = e.script.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
    out.push({
      id: `recent:q:${e.id}`,
      group: "recent",
      label: first.slice(0, 80),
      detail: `${e.sessionLabel} · ${e.db}`,
      keywords: e.script.trim().slice(0, 500),
    });
  }
  const seenC = new Set<string>();
  let n = 0;
  for (const c of colls) {
    if (n >= RECENT_LIMIT) break;
    const id = `${RECENT_COLL_PREFIX}${c.connId ?? ""}/${c.db}/${c.coll}`;
    if (seenC.has(id)) continue;
    seenC.add(id);
    n++;
    out.push({ id, group: "recent", label: `${c.db}.${c.coll}` });
  }
  return out;
}
