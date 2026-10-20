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

/** Always critical regardless of arguments: no filter/collection scope could make these safe. */
const ALWAYS_CRITICAL = ["dropDatabase", "drop", "dropIndex", "dropIndexes"];

/** Critical only when a literal empty filter is detected — a whole-collection write in disguise. */
const CRITICAL_WHEN_EMPTY_FILTER = ["deleteMany", "updateMany", "remove"];

/** True for `.name()` or `.name({})` (literal empty first-arg); best-effort like `scanDestructive` — a filter in a variable falls through to the warn tier. */
function hasEmptyFilterCall(code: string, name: string): boolean {
  const zeroArgs = new RegExp(`\\.\\s*${name}\\s*\\(\\s*\\)`);
  const emptyObjectArg = new RegExp(`\\.\\s*${name}\\s*\\(\\s*\\{\\s*\\}\\s*[,)]`);
  return zeroArgs.test(code) || emptyObjectArg.test(code);
}

/** Return the distinct critical-tier method names invoked — these bypass the suppressible warn
 *  dialog entirely and always require a typed confirmation (see `queryScript.svelte.ts` `run()`). */
export function scanCritical(script: string): string[] {
  const code = stripComments(script);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of ALWAYS_CRITICAL) {
    const re = new RegExp(`\\.\\s*${name}\\s*\\(`);
    if (re.test(code) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  for (const name of CRITICAL_WHEN_EMPTY_FILTER) {
    if (hasEmptyFilterCall(code, name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Literal `load("name")` / `load('name')` / `` load(`name`) `` call sites (after comment stripping). */
const LOAD_CALL = /\bload\s*\(\s*(["'`])((?:(?!\1)[^\\])*)\1\s*\)/g;
/** Every mention of the identifier `load`: calls, aliases (`var l = load`), `globalThis.load`, ... */
const LOAD_REF = /\bload\b/g;

/**
 * The script followed by the source of every saved query it `load()`s (transitively, up to `maxDepth` levels, matching the engine), so the destructive scans cover code that is not in the editor.
 * Fails closed: `unresolved` is true when the code mentions `load` in a way that cannot be traced to a known snippet
 * (a non-literal or template-interpolated argument, an alias, an unknown name, or `lookup` unavailable because the library is not loaded) — callers must then ask for confirmation.
 */
export function withLoadedSnippets(
  script: string,
  lookup: (name: string) => string | undefined,
  maxDepth = 8,
): { text: string; unresolved: boolean } {
  const parts = [script];
  let unresolved = false;
  let level = [script];
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next: string[] = [];
    for (const src of level) {
      const code = stripComments(src);
      let resolved = 0;
      for (const match of code.matchAll(LOAD_CALL)) {
        if (match[1] === "`" && match[2].includes("${")) continue;
        const body = lookup(match[2]);
        if (body !== undefined) {
          resolved++;
          next.push(body);
        }
      }
      if ((code.match(LOAD_REF)?.length ?? 0) > resolved) unresolved = true;
    }
    parts.push(...next);
    level = next;
  }
  return { text: parts.join("\n"), unresolved };
}
