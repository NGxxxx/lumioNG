import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export type DialogFilter = { name: string; extensions: string[] };

/** Opens a save dialog; returns the chosen path or null if the user cancels. */
export async function saveDialog(
  defaultName: string,
  filters: DialogFilter[],
): Promise<string | null> {
  return await save({ defaultPath: defaultName, filters });
}

/** Opens a single-file open dialog; returns the chosen path or null if cancelled. */
export async function openDialog(filters: DialogFilter[]): Promise<string | null> {
  const result = await open({ multiple: false, directory: false, filters });
  return typeof result === "string" ? result : null;
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}
