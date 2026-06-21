/** Pure helpers for the Query tab's aggregate statement (no Svelte/Tauri). */

/** Full mongosh-style statement seeded into a new Query editor. */
export function aggregateTemplate(coll: string): string {
  return `db.getCollection("${coll}").aggregate([\n  { "$match": {} }\n])`;
}

/** Extract the target collection and the pipeline-array text from a statement.
 *  Recognizes db.getCollection("X").aggregate(<arg>) and db.X.aggregate(<arg>).
 *  Throws on a malformed statement or an empty collection name. */
export function parseAggregateStatement(text: string): { coll: string; pipelineText: string } {
  const collMatch =
    text.match(/getCollection\(\s*["']([^"']*)["']\s*\)\s*\.\s*aggregate\s*\(/) ??
    text.match(/\bdb\s*\.\s*([A-Za-z0-9_$.]+)\s*\.\s*aggregate\s*\(/);
  if (!collMatch) {
    throw new Error('Expected db.getCollection("…").aggregate([ … ])');
  }
  const coll = collMatch[1];
  if (!coll) throw new Error("Specify a collection name in getCollection(\"…\")");

  // Pipeline argument = substring between the first "aggregate(" and the last ")".
  const open = text.indexOf("aggregate(", collMatch.index ?? 0);
  const start = open + "aggregate(".length;
  const end = text.lastIndexOf(")");
  if (open === -1 || end <= start) throw new Error("Could not read the aggregate( … ) argument");
  const pipelineText = text.slice(start, end).trim();
  return { coll, pipelineText };
}

/** True when the pipeline array's last stage is a `$limit` (so we should NOT inject a cap). */
export function pipelineHasTrailingLimit(pipelineText: string): boolean {
  try {
    const arr = JSON.parse(pipelineText);
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const last = arr[arr.length - 1];
    return !!last && typeof last === "object" && "$limit" in last;
  } catch {
    return false;
  }
}
