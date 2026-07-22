import type { Doc } from "./doc";

export type ConsoleEntry = { level: "log" | "error"; text: string };
export type ResultDisplay =
  | { kind: "docs"; rows: string[] }
  | {
      kind: "cursorQuery";
      cursorKind: "find" | "agg";
      db: string;
      coll: string;
      query: string;
      sort: string | null;
      projection: string | null;
      baseSkip: number;
      fixedLimit: number | null;
    }
  | { kind: "value"; json: string }
  | { kind: "ack"; json: string }
  | { kind: "none" };
export type Provenance = { db: string; coll: string };
/** The originating query of the script's single constructed Cursor, if exactly one was made — lets Explain work on scripts that transform cursor rows. */
export type ExplainHint = {
  cursorKind: "find" | "agg";
  db: string;
  coll: string;
  query: string;
  sort: string | null;
  projection: string | null;
  skip: number;
  limit: number | null;
};
export type ScriptOutcome = {
  console: ConsoleEntry[];
  result: ResultDisplay;
  provenance: Provenance | null;
  capped: boolean;
  error: string | null;
  // Optional so existing test fixtures don't need updating for a field they don't exercise —
  // the real backend always sends it (`null` when not applicable).
  explainHint?: ExplainHint | null;
};

export type DisplayMode = "grid-editable" | "grid-readonly" | "ack" | "value" | "none";

export function displayMode(o: ScriptOutcome): DisplayMode {
  switch (o.result.kind) {
    case "docs": return o.provenance ? "grid-editable" : "grid-readonly";
    case "cursorQuery": return o.provenance ? "grid-editable" : "grid-readonly";
    case "ack": return "ack";
    case "value": return "value";
    default: return "none";
  }
}

export function parseRows(rows: string[]): Doc[] {
  return rows.map((s) => JSON.parse(s) as Doc);
}

export type ResultViewMode = "grid" | "tree" | "console" | "explain";

/** Decide the result view to show after a run: console-only output always jumps to Console; otherwise leaving Console lands on Grid and any existing Grid/Tree choice is left untouched. */
export function nextResultView(
  current: ResultViewMode,
  mode: DisplayMode,
  hasConsoleOutput: boolean,
): ResultViewMode {
  if (mode === "none" && hasConsoleOutput) return "console";
  if (current === "console" || current === "explain") return "grid";
  return current;
}
