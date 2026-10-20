import { invoke } from "@tauri-apps/api/core";

/** Every stored UI preference (empty when none were saved yet). */
export async function loadPrefs(): Promise<Record<string, string>> {
  return await invoke<Record<string, string>>("prefs_load");
}

/** Replaces the stored preferences with `entries`. */
export async function savePrefs(entries: Record<string, string>): Promise<void> {
  await invoke("prefs_save", { entries });
}

/** Writes the stored preferences (without secrets) to a file. */
export async function exportPrefs(path: string): Promise<void> {
  await invoke("prefs_export", { path });
}

/** Reads a settings file produced by `exportPrefs`. */
export async function importPrefs(path: string): Promise<Record<string, string>> {
  return await invoke<Record<string, string>>("prefs_import", { path });
}
