import { invoke, Channel } from "@tauri-apps/api/core";
import type { ConsoleEntry, Provenance, ScriptOutcome, ExplainHint } from "../domain/scriptOutcome";

export type { ConsoleEntry, Provenance, ExplainHint };

/** `confirmed`: the destructive/critical gate was passed (PROD `load()` of destructive snippets needs it). `onOutput` receives each print/console line as the script produces it (the final outcome still carries them all). */
export async function runScript(
  sessionId: string, db: string, script: string,
  opts: { timeoutMs?: number; cap?: number; confirmed?: boolean; onOutput?: (entry: ConsoleEntry) => void } = {},
): Promise<ScriptOutcome> {
  const onOutput = new Channel<ConsoleEntry>();
  onOutput.onmessage = (entry) => opts.onOutput?.(entry);
  return await invoke<ScriptOutcome>("run_script", {
    sessionId, db, script, timeoutMs: opts.timeoutMs ?? null, cap: opts.cap ?? null, confirmed: opts.confirmed ?? false, onOutput,
  });
}

export async function cancelScript(sessionId: string): Promise<void> {
  await invoke("cancel_script", { sessionId });
}
