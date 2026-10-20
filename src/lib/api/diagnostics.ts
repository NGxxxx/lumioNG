import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "error" | "warn" | "info";

/** One crash report written by a previous run (see the Rust panic hook). */
export interface CrashReport {
  /** Path of the report file. */
  file: string;
  createdMs: number;
  /** The panic message. */
  summary: string;
}

/** Records a frontend line in the app log file (redacted on the Rust side). */
export async function logFrontend(level: LogLevel, message: string, context?: string): Promise<void> {
  await invoke("log_frontend", { level, message, context: context ?? null });
}

/** Saves a diagnostics .zip (versions, recent logs, redacted connection list, setting names) to `path`. `settingsKeys` are key names only, never values. */
export async function exportDiagnostics(path: string, settingsKeys: string[]): Promise<void> {
  await invoke("export_diagnostics", { path, settingsKeys });
}

/** Crash reports written since the last call; the backend moves them to a "seen" folder. */
export async function takeCrashReports(): Promise<CrashReport[]> {
  return await invoke<CrashReport[]>("take_crash_reports");
}

export async function openCrashFolder(): Promise<void> {
  await invoke("open_crash_folder");
}
