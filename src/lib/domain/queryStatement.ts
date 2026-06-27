/** Pure parser for the Query tab's statement (no Svelte/Tauri). Recognizes aggregate / find /
 *  count(Documents) and returns a discriminated-union ParsedQuery. Heavily tested. */

export type ParsedQuery =
  | { kind: "aggregate"; coll: string; pipeline: string }
  | {
      kind: "find";
      coll: string;
      filter: string;
      projection: string | null;
      sort: string | null;
      skip: number | null;
      limit: number | null;
    }
  | { kind: "count"; coll: string; filter: string }
  | { kind: "distinct"; coll: string; field: string; filter: string }
  | { kind: "insertOne"; coll: string; doc: string }
  | { kind: "insertMany"; coll: string; docs: string }
  | { kind: "updateOne" | "updateMany"; coll: string; filter: string; update: string }
  | { kind: "replaceOne"; coll: string; filter: string; replacement: string }
  | { kind: "deleteOne" | "deleteMany"; coll: string; filter: string };

/** Full mongosh-style statement seeded into a new Query editor. */
export function aggregateTemplate(coll: string): string {
  return `db.getCollection("${coll}").aggregate([\n  { "$match": {} }\n])`;
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

// db.getCollection("X").<m>(   OR   db.X.<m>(   — countDocuments before count so the longer wins.
const HEAD =
  /(?:getCollection\(\s*["']([^"']*)["']\s*\)|\bdb\s*\.\s*([A-Za-z0-9_$.]+))\s*\.\s*(aggregate|find|countDocuments|count|distinct|insertOne|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany)\s*\(/;

/** Index of the bracket matching the opener at `open` (respects nesting + string literals).
 *  Returns -1 if unbalanced. Supports {} [] (). */
function matchSpan(text: string, open: number): number {
  let depth = 0;
  let inStr = false;
  let quote = "";
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split an argument-list body on commas at bracket-depth 0 (respects strings). */
function splitArgs(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let quote = "";
  let esc = false;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts;
}

interface Chain { sort: string | null; skip: number | null; limit: number | null }

/** Scan the cursor-method chain after find(...): .sort/.skip/.limit in any order; tolerate
 *  .toArray() and ;/whitespace; throw on anything else. */
function parseChain(rest: string): Chain {
  let sort: string | null = null;
  let skip: number | null = null;
  let limit: number | null = null;
  let i = 0;
  while (i < rest.length) {
    const ch = rest[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ";") { i++; continue; }
    if (ch !== ".") throw new Error(`Unexpected token "${ch}" after find(…)`);
    const mm = rest.slice(i + 1).match(/^([A-Za-z0-9_$]+)\s*\(/);
    if (!mm) throw new Error("Expected a chained .method( … ) after find(…)");
    const name = mm[1];
    const open = i + 1 + mm[0].length - 1; // index of "(" in rest
    const close = matchSpan(rest, open);
    if (close === -1) throw new Error(`Unbalanced ( ) in .${name}( … )`);
    const arg = rest.slice(open + 1, close).trim();
    if (name === "sort") {
      sort = arg; // last wins
    } else if (name === "skip" || name === "limit") {
      if (!/^-?\d+$/.test(arg)) throw new Error(`.${name}(n) expects an integer`);
      const n = parseInt(arg, 10);
      if (name === "skip") skip = n; else limit = n;
    } else if (name === "toArray") {
      if (arg !== "") throw new Error(".toArray() takes no arguments");
    } else {
      throw new Error(`Unsupported method .${name}() — supported: .sort, .skip, .limit`);
    }
    i = close + 1;
  }
  return { sort, skip, limit };
}

/** Tolerant: just the collection name (no argument balancing), for autocomplete on partial text. */
export function collectionOf(text: string): string | null {
  const m = text.match(HEAD);
  if (!m) return null;
  return (m[1] ?? m[2]) || null;
}

/** If `raw` (trimmed) is exactly one "…" or '…' string literal, return its unescaped content;
 *  otherwise null. Used for the distinct(field) argument. */
function parseStringLiteral(raw: string): string | null {
  const s = raw.trim();
  if (s.length < 2) return null;
  const q = s[0];
  if ((q !== '"' && q !== "'") || s[s.length - 1] !== q) return null;
  let out = "";
  let esc = false;
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === q) return null; // an unescaped closing quote before the end → not a single literal
    out += ch;
  }
  if (esc) return null; // dangling backslash
  return out;
}

/** Strict: parse a full statement. Throws on malformed input or an unsupported chained method. */
export function parseQueryStatement(text: string): ParsedQuery {
  const m = text.match(HEAD);
  if (!m || m.index === undefined) {
    throw new Error("Expected db.<coll>.find(…) / .aggregate(…) / .countDocuments(…)");
  }
  const coll = m[1] ?? m[2];
  if (!coll) throw new Error("Specify a collection name");
  const method = m[3];

  const open = m.index + m[0].length - 1; // the "(" is the last char of the matched head
  const close = matchSpan(text, open);
  if (close === -1) throw new Error("Unbalanced ( ) in the statement");
  const inner = text.slice(open + 1, close).trim();
  const rest = text.slice(close + 1);

  if (method === "aggregate") {
    return { kind: "aggregate", coll, pipeline: inner };
  }

  if (method === "count" || method === "countDocuments") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error(`Unsupported trailing call after ${method}(…)`);
    const args = inner === "" ? [] : splitArgs(inner);
    return { kind: "count", coll, filter: args.length === 0 ? "{}" : args[0].trim() || "{}" };
  }

  if (method === "distinct") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error("Unsupported trailing call after distinct(…)");
    const args = inner === "" ? [] : splitArgs(inner);
    if (args.length > 2) throw new Error("distinct takes a field and an optional filter");
    const field = args.length >= 1 ? parseStringLiteral(args[0]) : null;
    if (field === null) {
      throw new Error('distinct(field) — field must be a string literal, e.g. distinct("status")');
    }
    const filter = args.length >= 2 ? args[1].trim() || "{}" : "{}";
    return { kind: "distinct", coll, field, filter };
  }

  if (method === "insertOne" || method === "insertMany") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error(`Unsupported trailing call after ${method}(…)`);
    const args = inner === "" ? [] : splitArgs(inner);
    if (args.length !== 1 || args[0].trim() === "") {
      throw new Error(
        method === "insertOne" ? "insertOne(doc) requires a document"
                               : "insertMany([…]) requires an array of documents",
      );
    }
    const body = args[0].trim();
    return method === "insertOne"
      ? { kind: "insertOne", coll, doc: body }
      : { kind: "insertMany", coll, docs: body };
  }

  if (method === "updateOne" || method === "updateMany") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error(`Unsupported trailing call after ${method}(…)`);
    const args = inner === "" ? [] : splitArgs(inner);
    if (args.length > 2) throw new Error(`${method} takes only a filter and an update (options are not supported yet)`);
    const filter = args.length >= 1 ? args[0].trim() : "";
    const update = args.length >= 2 ? args[1].trim() : "";
    if (filter === "" || update === "") throw new Error(`${method}(filter, update) requires a filter and an update`);
    return { kind: method, coll, filter, update };
  }

  if (method === "replaceOne") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error("Unsupported trailing call after replaceOne(…)");
    const args = inner === "" ? [] : splitArgs(inner);
    if (args.length > 2) throw new Error("replaceOne takes only a filter and a replacement (options are not supported yet)");
    const filter = args.length >= 1 ? args[0].trim() : "";
    const replacement = args.length >= 2 ? args[1].trim() : "";
    if (filter === "" || replacement === "") throw new Error("replaceOne(filter, replacement) requires a filter and a replacement");
    return { kind: "replaceOne", coll, filter, replacement };
  }

  if (method === "deleteOne" || method === "deleteMany") {
    if (rest.replace(/[\s;]/g, "") !== "") throw new Error(`Unsupported trailing call after ${method}(…)`);
    const args = inner === "" ? [] : splitArgs(inner);
    if (args.length > 1) throw new Error(`${method} takes only a filter (options are not supported yet)`);
    const filter = args.length >= 1 ? args[0].trim() : "";
    if (filter === "") throw new Error(`${method}(filter) requires a filter — pass {} to target all documents`);
    return { kind: method, coll, filter };
  }

  // find(filter?, projection?)
  const args = inner === "" ? [] : splitArgs(inner);
  if (args.length > 2) throw new Error("find takes at most a filter and a projection");
  const filter = args.length === 0 ? "{}" : args[0].trim() || "{}";
  const projection = args.length >= 2 ? args[1].trim() || null : null;
  const chain = parseChain(rest);
  return { kind: "find", coll, filter, projection, ...chain };
}

const WRITE_KINDS: ReadonlySet<string> = new Set([
  "insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany",
]);
const DESTRUCTIVE_KINDS: ReadonlySet<string> = new Set([
  "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany",
]);

/** True for any of the seven write kinds. */
export function isWriteKind(kind: ParsedQuery["kind"]): boolean {
  return WRITE_KINDS.has(kind);
}

/** True for update/replace/delete (writes that change or remove existing data). */
export function isDestructiveKind(kind: ParsedQuery["kind"]): boolean {
  return DESTRUCTIVE_KINDS.has(kind);
}

/** True when a destructive write's filter is the empty document {} (whole-collection scope). */
export function writeFilterIsEmpty(parsed: ParsedQuery): boolean {
  switch (parsed.kind) {
    case "updateOne":
    case "updateMany":
    case "replaceOne":
    case "deleteOne":
    case "deleteMany":
      return parsed.filter.replace(/\s/g, "") === "{}";
    default:
      return false;
  }
}

/** The argument most worth echoing in a confirm dialog: the doc(s) for inserts, the filter otherwise. */
export function writeTargetSummary(parsed: ParsedQuery): string {
  switch (parsed.kind) {
    case "insertOne": return parsed.doc;
    case "insertMany": return parsed.docs;
    case "updateOne":
    case "updateMany":
    case "replaceOne":
    case "deleteOne":
    case "deleteMany":
      return parsed.filter;
    default: return "";
  }
}
