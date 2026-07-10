/** Pure helpers for the Query tab editor (no Svelte/Tauri): seeding a new statement template and
 *  locating the method call governing the cursor, for autocomplete. */

/** Full mongosh-style statement seeded into a new Query editor. */
export function aggregateTemplate(coll: string): string {
  return `db.getCollection("${coll}").aggregate([\n  { "$match": {} }\n])`;
}

// db.getCollection("X").<m>(   OR   db.X.<m>(   — countDocuments before count so the longer wins.
const HEAD =
  /(?:getCollection\(\s*["']([^"']*)["']\s*\)|\bdb\s*\.\s*([A-Za-z0-9_$.]+))\s*\.\s*(aggregate|find|countDocuments|count|distinct|insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany)\s*\(/;

/** Locate the supported method call governing the cursor: the last `db.<coll>.<method>(` whose `(` is at or before `pos`, so multi-statement editors classify the right statement; null if none. */
export function methodHeadAt(
  text: string,
  pos: number,
): { method: string; coll: string; argOpen: number } | null {
  const re = new RegExp(HEAD.source, "g");
  let best: { method: string; coll: string; argOpen: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const argOpen = m.index + m[0].length - 1;
    if (argOpen > pos) break; // matches run left-to-right; the rest open after the cursor
    best = { method: m[3], coll: m[1] ?? m[2], argOpen };
  }
  return best;
}
