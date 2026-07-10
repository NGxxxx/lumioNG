/** Pure completion brain for the Query editor: detect cursor context + build options.
 *  No CodeMirror, no Svelte. */
import { PIPELINE_STAGES, QUERY_OPERATORS, EXPR_OPERATORS, COLLECTION_METHODS, CURSOR_METHODS, DB_METHODS, type OpEntry } from "./mongoOps";
import { methodHeadAt } from "./queryStatement";

export type CompletionKind = "collection" | "method" | "cursor" | "stage" | "field" | "exprOp" | "fieldRef" | "none";
export interface CtxResult {
  kind: CompletionKind;
  from: number;
  prefix: string;
}
export interface CompleteResult {
  from: number;
  kind: CompletionKind;
  options: OpEntry[];
}

const IDENT = /[A-Za-z0-9_$]/; // note: '.' excluded so `db.` is a boundary

/** The run of identifier chars immediately before `pos` → the token being typed. */
function tokenBefore(text: string, pos: number): { from: number; prefix: string } {
  let i = pos;
  while (i > 0 && IDENT.test(text[i - 1])) i--;
  return { from: i, prefix: text.slice(i, pos) };
}

type Frame = { type: "obj"; expectKey: boolean } | { type: "arr" } | { type: "paren" };
interface ScanResult { pos: "stage" | "field" | "value" | "none"; inString: boolean }

/** Walk `[from,to)` tracking string state + a bracket stack (obj/arr/paren) to classify the position at `to` as a top-level pipeline stage key vs. an ordinary field key. */
function scanContext(text: string, from: number, to: number, isAggregate: boolean): ScanResult {
  const stack: Frame[] = [];
  let inStr = false;
  let quote = "";
  let esc = false;
  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === "{") { stack.push({ type: "obj", expectKey: true }); continue; }
    if (ch === "[") { stack.push({ type: "arr" }); continue; }
    if (ch === "(") { stack.push({ type: "paren" }); continue; }
    if (ch === "}" || ch === "]" || ch === ")") { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (!top || top.type !== "obj") continue;
    if (ch === ":") top.expectKey = false;
    else if (ch === ",") top.expectKey = true;
  }
  const top = stack[stack.length - 1];
  let pos: ScanResult["pos"];
  if (!top || top.type === "arr" || top.type === "paren") {
    pos = "none";
  } else if (top.expectKey) {
    const below = stack[stack.length - 2];
    const isStage = isAggregate && stack.length === 2 && below?.type === "arr";
    pos = isStage ? "stage" : "field";
  } else {
    pos = "value";
  }
  return { pos, inString: inStr };
}

export function contextAt(text: string, pos: number): CtxResult {
  const { from, prefix } = tokenBefore(text, pos);
  const before = text.slice(0, from);

  // Collection: right after `db.` or inside getCollection("…
  if (/\bdb\.\s*$/.test(before)) return { kind: "collection", from, prefix };
  if (/getCollection\(\s*["'][^"']*$/.test(before)) return { kind: "collection", from, prefix };

  // Method: right after `db.<coll>.` or `getCollection("x").`
  if (/(?:\bdb\.\s*[A-Za-z0-9_$.]+|getCollection\(\s*["'][^"']*["']\s*\))\s*\.\s*$/.test(before)) {
    return { kind: "method", from, prefix };
  }

  // Cursor method: right after a cursor-returning call's close paren, restricted to find/aggregate so writes don't qualify.
  if (/\)\s*\.\s*$/.test(before)) {
    const cursorHead = methodHeadAt(text, pos);
    if (cursorHead && (cursorHead.method === "find" || cursorHead.method === "aggregate")) {
      return { kind: "cursor", from, prefix };
    }
  }

  const head = methodHeadAt(text, pos);
  if (!head) return { kind: "none", from, prefix };

  const isAggregate = head.method === "aggregate";
  const scanned = scanContext(text, head.argOpen + 1, from, isAggregate);

  if (scanned.pos === "stage") return { kind: "stage", from, prefix };
  if (scanned.pos === "field") return { kind: "field", from, prefix };
  if (scanned.pos === "value" && prefix.startsWith("$")) {
    // a $-prefixed token inside an open string is a field reference (e.g. "$amount"), otherwise an expression operator (e.g. $sum).
    return { kind: scanned.inString ? "fieldRef" : "exprOp", from, prefix };
  }
  return { kind: "none", from, prefix };
}

export function needsFields(kind: CompletionKind): boolean {
  return kind === "field" || kind === "fieldRef";
}

/** Case-insensitive prefix filter, preserving catalog/source order. */
function byPrefix(items: OpEntry[], prefix: string): OpEntry[] {
  const p = prefix.toLowerCase();
  return items.filter((it) => it.label.toLowerCase().startsWith(p));
}

/** db-level methods (incl. getCollection) are offered only right after `db.`, not inside
 *  getCollection("…. */
function dbMethodExtras(before: string): OpEntry[] {
  return /\bdb\.\s*$/.test(before) ? [...DB_METHODS] : [];
}

export function completeAt(
  text: string,
  pos: number,
  sources: { collections: string[]; fields: string[] },
): CompleteResult | null {
  const { kind, from, prefix } = contextAt(text, pos);
  if (kind === "none") return null;

  let pool: OpEntry[];
  if (kind === "collection") {
    pool = [...sources.collections.map((label) => ({ label })), ...dbMethodExtras(text.slice(0, from))];
  } else if (kind === "method") pool = [...COLLECTION_METHODS];
  else if (kind === "cursor") pool = [...CURSOR_METHODS];
  else if (kind === "stage") pool = [...PIPELINE_STAGES];
  else if (kind === "exprOp") pool = [...EXPR_OPERATORS];
  else if (kind === "fieldRef") pool = sources.fields.map((f) => ({ label: "$" + f }));
  else pool = [...sources.fields.map((label) => ({ label })), ...QUERY_OPERATORS]; // field

  const options = byPrefix(pool, prefix);
  return options.length ? { from, kind, options } : null; // null when nothing matches
}
