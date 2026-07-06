import type { ScriptOutcome } from "../api/script";
import type { Doc } from "./doc";

export type DisplayMode = "grid-editable" | "grid-readonly" | "ack" | "value" | "none";

export function displayMode(o: ScriptOutcome): DisplayMode {
  switch (o.result.kind) {
    case "docs": return o.provenance ? "grid-editable" : "grid-readonly";
    case "ack": return "ack";
    case "value": return "value";
    default: return "none";
  }
}

export function parseRows(rows: string[]): Doc[] {
  return rows.map((s) => JSON.parse(s) as Doc);
}

export type ResultViewMode = "grid" | "tree" | "console";

/** Decide the result view to show after a run, given what it produced.
 *  Console-only output (no docs/value/ack) always jumps to Console; otherwise leaving
 *  Console lands on Grid, and any existing Grid/Tree choice is left untouched. */
export function nextResultView(
  current: ResultViewMode,
  mode: DisplayMode,
  hasConsoleOutput: boolean,
): ResultViewMode {
  if (mode === "none" && hasConsoleOutput) return "console";
  if (current === "console") return "grid";
  return current;
}
