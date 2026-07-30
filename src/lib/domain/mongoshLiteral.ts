/** Parses a bounded subset of mongosh literal syntax — JS object/array literals with unquoted or
 *  quoted keys, single/double-quoted strings, and a whitelist of BSON constructor calls — into
 *  canonical Extended JSON values (the same shapes `domain/extjson.ts`'s `describeValue`
 *  recognizes). Used to read an existing Query tab script back into the Pipeline Tree editor;
 *  anything outside this subset (real variables, arbitrary function calls, control flow) fails to
 *  parse, and callers fall back to script-only editing rather than guessing. */

export interface LiteralParseResult {
  ok: true;
  value: unknown;
  /** Index right after the last character consumed — callers check what (if anything) follows. */
  end: number;
}
export interface LiteralParseFailure {
  ok: false;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const CONSTRUCTORS = new Set(["ObjectId", "ISODate", "NumberLong", "NumberDecimal", "NumberInt"]);
const KEYWORD = /^(true|false|null)(?![A-Za-z0-9_$])/;

class Cursor {
  pos: number;
  constructor(public text: string, start: number) {
    this.pos = start;
  }
  peek(): string {
    return this.text[this.pos] ?? "";
  }
  atEnd(): boolean {
    return this.pos >= this.text.length;
  }
  skipWs(): void {
    while (!this.atEnd() && /\s/.test(this.peek())) this.pos++;
  }
}

function parseStringLiteral(c: Cursor): string | undefined {
  const quote = c.peek();
  if (quote !== '"' && quote !== "'") return undefined;
  c.pos++;
  let out = "";
  const escapes: Record<string, string> = { '"': '"', "'": "'", "\\": "\\", n: "\n", t: "\t", r: "\r", "/": "/", b: "\b", f: "\f" };
  while (!c.atEnd() && c.peek() !== quote) {
    const ch = c.peek();
    if (ch === "\\") {
      c.pos++;
      const esc = c.peek();
      if (esc in escapes) {
        out += escapes[esc];
        c.pos++;
      } else if (esc === "u") {
        const hex = c.text.slice(c.pos + 1, c.pos + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        c.pos += 5;
      } else {
        return undefined;
      }
    } else {
      out += ch;
      c.pos++;
    }
  }
  if (c.peek() !== quote) return undefined;
  c.pos++;
  return out;
}

function parseNumberLiteral(c: Cursor): number | undefined {
  const start = c.pos;
  if (c.peek() === "-") c.pos++;
  if (!/[0-9]/.test(c.peek())) {
    c.pos = start;
    return undefined;
  }
  while (/[0-9]/.test(c.peek())) c.pos++;
  if (c.peek() === ".") {
    c.pos++;
    while (/[0-9]/.test(c.peek())) c.pos++;
  }
  if (c.peek() === "e" || c.peek() === "E") {
    c.pos++;
    if (c.peek() === "+" || c.peek() === "-") c.pos++;
    while (/[0-9]/.test(c.peek())) c.pos++;
  }
  const n = Number(c.text.slice(start, c.pos));
  return Number.isNaN(n) ? undefined : n;
}

function parseIdentifier(c: Cursor): string | null {
  if (!IDENT_START.test(c.peek())) return null;
  const start = c.pos;
  c.pos++;
  while (!c.atEnd() && IDENT_PART.test(c.peek())) c.pos++;
  return c.text.slice(start, c.pos);
}

function parseConstructorCall(c: Cursor, name: string): unknown {
  c.pos++; // consume "("
  c.skipWs();
  let arg: unknown;
  if (c.peek() !== ")") {
    arg = parseValue(c);
    if (arg === undefined) return undefined;
    c.skipWs();
  }
  if (c.peek() !== ")") return undefined;
  c.pos++; // consume ")"

  switch (name) {
    case "ObjectId": {
      if (typeof arg !== "string" || !/^[0-9a-fA-F]{24}$/.test(arg)) return undefined;
      return { $oid: arg };
    }
    case "ISODate": {
      if (arg !== undefined && typeof arg !== "string") return undefined;
      const ms = Date.parse((arg as string | undefined) ?? new Date().toISOString());
      return Number.isNaN(ms) ? undefined : { $date: { $numberLong: String(ms) } };
    }
    case "NumberLong":
      return typeof arg === "string" || typeof arg === "number" ? { $numberLong: String(arg) } : undefined;
    case "NumberDecimal":
      return typeof arg === "string" || typeof arg === "number" ? { $numberDecimal: String(arg) } : undefined;
    case "NumberInt": {
      if (typeof arg !== "string" && typeof arg !== "number") return undefined;
      const n = Math.trunc(Number(arg));
      return Number.isNaN(n) ? undefined : { $numberInt: String(n) };
    }
    default:
      return undefined;
  }
}

function parseObject(c: Cursor): Record<string, unknown> | undefined {
  c.pos++; // consume "{"
  const out: Record<string, unknown> = {};
  c.skipWs();
  if (c.peek() === "}") {
    c.pos++;
    return out;
  }
  for (;;) {
    c.skipWs();
    const key = c.peek() === '"' || c.peek() === "'" ? parseStringLiteral(c) : (parseIdentifier(c) ?? undefined);
    if (key === undefined) return undefined;
    c.skipWs();
    if (c.peek() !== ":") return undefined;
    c.pos++;
    c.skipWs();
    const v = parseValue(c);
    if (v === undefined) return undefined;
    out[key] = v;
    c.skipWs();
    if (c.peek() === ",") {
      c.pos++;
      c.skipWs();
      if (c.peek() === "}") {
        c.pos++;
        return out;
      }
      continue;
    }
    if (c.peek() === "}") {
      c.pos++;
      return out;
    }
    return undefined;
  }
}

function parseArray(c: Cursor): unknown[] | undefined {
  c.pos++; // consume "["
  const out: unknown[] = [];
  c.skipWs();
  if (c.peek() === "]") {
    c.pos++;
    return out;
  }
  for (;;) {
    c.skipWs();
    const v = parseValue(c);
    if (v === undefined) return undefined;
    out.push(v);
    c.skipWs();
    if (c.peek() === ",") {
      c.pos++;
      c.skipWs();
      if (c.peek() === "]") {
        c.pos++;
        return out;
      }
      continue;
    }
    if (c.peek() === "]") {
      c.pos++;
      return out;
    }
    return undefined;
  }
}

/** Parses one value at the cursor. Returns the sentinel `undefined` on failure — distinguishable
 *  from a real parsed `null`, which is the JS value `null`, never `undefined`. */
function parseValue(c: Cursor): unknown {
  c.skipWs();
  const ch = c.peek();
  if (ch === "{") return parseObject(c);
  if (ch === "[") return parseArray(c);
  if (ch === '"' || ch === "'") return parseStringLiteral(c);
  if (ch === "-" || /[0-9]/.test(ch)) return parseNumberLiteral(c);

  const kw = KEYWORD.exec(c.text.slice(c.pos));
  if (kw) {
    c.pos += kw[1].length;
    return kw[1] === "true" ? true : kw[1] === "false" ? false : null;
  }

  const ident = parseIdentifier(c);
  if (ident !== null) {
    c.skipWs();
    if (c.peek() === "(" && CONSTRUCTORS.has(ident)) return parseConstructorCall(c, ident);
    return undefined; // bare identifier (a variable reference) — not a literal
  }
  return undefined;
}

/** Parses a single literal value starting at `start`. Fails for anything outside the supported
 *  literal subset (real variables, unwhitelisted function calls, syntax errors). */
export function parseMongoshValue(text: string, start = 0): LiteralParseResult | LiteralParseFailure {
  const c = new Cursor(text, start);
  const value = parseValue(c);
  if (value === undefined) return { ok: false };
  return { ok: true, value, end: c.pos };
}
