import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export type DialogFilter = { name: string; extensions: string[] };

/** Mở save dialog; trả path hoặc null nếu người dùng hủy. */
export async function saveDialog(
  defaultName: string,
  filters: DialogFilter[],
): Promise<string | null> {
  return await save({ defaultPath: defaultName, filters });
}

/** Mở open dialog (chọn 1 file); trả path hoặc null nếu hủy. */
export async function openDialog(filters: DialogFilter[]): Promise<string | null> {
  const result = await open({ multiple: false, directory: false, filters });
  return typeof result === "string" ? result : null;
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await invoke("write_text_file", { path, contents });
}
