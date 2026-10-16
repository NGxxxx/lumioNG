import { invoke } from "@tauri-apps/api/core";

/** Where one command's full text lives in the on-disk command log. */
export interface LogFileRef {
  path: string;
  offset: number;
  length: number;
}

export async function appendCommandLog(header: string, text: string): Promise<LogFileRef> {
  return await invoke<LogFileRef>("command_log_append", { header, text });
}

export async function readCommandLog(ref: LogFileRef): Promise<string> {
  return await invoke<string>("command_log_read", { path: ref.path, offset: ref.offset, length: ref.length });
}

export async function commandLogDir(): Promise<string> {
  return await invoke<string>("command_log_dir");
}

/** Deletes every command log file; resolves to how many were removed. */
export async function clearCommandLogFiles(): Promise<number> {
  return await invoke<number>("command_log_clear");
}
