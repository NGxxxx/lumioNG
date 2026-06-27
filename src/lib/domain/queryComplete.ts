/** Pure completion brain for the Query editor: detect cursor context + build options.
 *  No CodeMirror, no Svelte. */
import { PIPELINE_STAGES, QUERY_OPERATORS, EXPR_OPERATORS, type OpEntry } from "./mongoOps";

export type CompletionKind = "collection" | "stage" | "field" | "exprOp" | "none";
export interface CtxResult {
  kind: CompletionKind;
  from: number;
  prefix: string;
}
export interface CompleteResult {
  from: number;
  options: OpEntry[];
}

const IDENT = /[A-Za-z0-9_$]/; // note: '.' excluded so `db.` is a boundary

/** The run of identifier chars immediately before `pos` → the token being typed. */
function tokenBefore(text: string, pos: number): { from: number; prefix: string } {
  let i = pos;
  while (i > 0 && IDENT.test(text[i - 1])) i--;
  return { from: i, prefix: text.slice(i, pos) };
}

/** Walk `[from,to)` tracking string state + a bracket stack; report context at `to`.
 *  Frame for "{" carries expectKey (true right after "{" or ","; false after ":"). */
type Frame = { type: "obj"; expectKey: boolean } | { type: "arr" };
function scanContext(text: string, from: number, to: number): "stage" | "field" | "exprOp" | "none" {
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
    if (ch === "}" || ch === "]") { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (!top) continue;
    if (top.type === "obj") {
      if (ch === ":") top.expectKey = false;
      else if (ch === ",") top.expectKey = true;
    }
  }
  const top = stack[stack.length - 1];
  if (!top || top.type === "arr") return "none";
  const objDepth = stack.filter((f) => f.type === "obj").length;
  if (top.expectKey) return objDepth <= 1 ? "stage" : "field";
  return "exprOp"; // value position
}

/** Locate the pipeline argument: substring right after the first "aggregate(". */
function pipelineStart(text: string): number {
  const m = text.match(/aggregate\s*\(/);
  if (!m || m.index === undefined) return -1;
  return m.index + m[0].length;
}

export function contextAt(text: string, pos: number): CtxResult {
  const { from, prefix } = tokenBefore(text, pos);
  const before = text.slice(0, from);

  // Collection: right after `db.` or inside getCollection("…
  if (/\bdb\.\s*$/.test(before)) return { kind: "collection", from, prefix };
  if (/getCollection\(\s*["'][^"']*$/.test(before)) return { kind: "collection", from, prefix };

  const ps = pipelineStart(text);
  if (ps === -1 || pos < ps) return { kind: "none", from, prefix };

  const scanned = scanContext(text, ps, from); // scan up to token start, not into the token
  let kind: CompletionKind = scanned;
  if (scanned === "exprOp" && !prefix.startsWith("$")) kind = "none";
  return { kind, from, prefix };
}

export function needsFields(kind: CompletionKind): boolean {
  return kind === "field";
}

/** Case-insensitive prefix filter, preserving catalog/source order. */
function byPrefix(items: OpEntry[], prefix: string): OpEntry[] {
  const p = prefix.toLowerCase();
  return items.filter((it) => it.label.toLowerCase().startsWith(p));
}

export function completeAt(
  text: string,
  pos: number,
  sources: { collections: string[]; fields: string[] },
): CompleteResult | null {
  const { kind, from, prefix } = contextAt(text, pos);
  if (kind === "none") return null;

  let pool: OpEntry[];
  if (kind === "collection") pool = sources.collections.map((label) => ({ label }));
  else if (kind === "stage") pool = [...PIPELINE_STAGES];
  else if (kind === "exprOp") pool = [...EXPR_OPERATORS];
  else pool = [...sources.fields.map((label) => ({ label })), ...QUERY_OPERATORS]; // field

  const options = byPrefix(pool, prefix);
  return options.length ? { from, options } : null; // null when nothing matches (vs an empty popup)
}
