import { invoke } from "@tauri-apps/api/core";

export type ConsoleEntry = { level: "log" | "error"; text: string };
export type ResultDisplay =
  | { kind: "docs"; rows: string[] }
  | { kind: "value"; json: string }
  | { kind: "ack"; json: string }
  | { kind: "none" };
export type Provenance = { db: string; coll: string };
export type ScriptOutcome = {
  console: ConsoleEntry[];
  result: ResultDisplay;
  provenance: Provenance | null;
  capped: boolean;
  error: string | null;
};

export async function runScript(
  sessionId: string, db: string, script: string,
  opts: { timeoutMs?: number; cap?: number } = {},
): Promise<ScriptOutcome> {
  return await invoke<ScriptOutcome>("run_script", {
    sessionId, db, script, timeoutMs: opts.timeoutMs ?? null, cap: opts.cap ?? null,
  });
}

export async function cancelScript(sessionId: string): Promise<void> {
  await invoke("cancel_script", { sessionId });
}
