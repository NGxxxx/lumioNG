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
