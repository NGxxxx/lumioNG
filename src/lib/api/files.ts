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

/** Writes binary content (given base64-encoded) to `path`. */
export async function writeBase64File(path: string, data: string): Promise<void> {
  await invoke("write_base64_file", { path, data });
}

/** Reads a text file's contents, or `null` if it doesn't exist — used to detect a companion
 *  `.metadata.json` sidecar next to a chosen import file. */
export async function readTextFileIfExists(path: string): Promise<string | null> {
  return await invoke<string | null>("read_text_file_if_exists", { path });
}

/** Opens a directory-picker dialog; returns the chosen folder path or null if cancelled. */
export async function openDirDialog(): Promise<string | null> {
  const result = await open({ multiple: false, directory: true });
  return typeof result === "string" ? result : null;
}

/** Reads a file's byte length without loading its content — used to gate the large-file confirm notice. */
export async function importFileSize(path: string): Promise<number> {
  return await invoke<number>("import_file_size", { path });
}
