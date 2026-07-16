import { invoke } from "@tauri-apps/api/core";
import type { ConsoleEntry, ResultDisplay, Provenance, ScriptOutcome, ExplainHint } from "../domain/scriptOutcome";

export type { ConsoleEntry, ResultDisplay, Provenance, ScriptOutcome, ExplainHint };

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
