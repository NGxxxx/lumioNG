import { getVersion } from "@tauri-apps/api/app";

/** Reads the running app's version (from tauri.conf.json / Cargo.toml, kept in sync with package.json). */
export async function getAppVersion(): Promise<string> {
  return await getVersion();
}
