/** Method names that mutate or destroy data (pure inserts intentionally excluded, matching Studio 3T); best-effort static scan, the hard boundary is the Rust read-only lock. */
const DESTRUCTIVE = [
  "updateOne", "updateMany", "update",
  "replaceOne", "replace",
  "deleteOne", "deleteMany", "remove",
  "bulkWrite",
  "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "findAndModify",
  "dropIndexes", "dropIndex", "dropDatabase", "drop",
];

/** Strip line and block comments so commented-out code isn't flagged. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/** Return the distinct destructive method names invoked in the script, in first-seen order. */
export function scanDestructive(script: string): string[] {
  const code = stripComments(script);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of DESTRUCTIVE) {
    // method call: `.name(` with optional whitespace; word-boundary on the name.
    const re = new RegExp(`\\.\\s*${name}\\s*\\(`);
    if (re.test(code) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}
