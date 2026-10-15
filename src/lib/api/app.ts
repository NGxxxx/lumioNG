import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Opens a web page in the system browser (scoped in capabilities/default.json). */
export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}

/** Reads the running app's version (from tauri.conf.json / Cargo.toml, kept in sync with package.json). */
export async function getAppVersion(): Promise<string> {
  return await getVersion();
}

/** Version, commit, build date, OS/arch and webview version of the running build. */
export async function getAppInfo(): Promise<import("../domain/aboutInfo").AppInfo> {
  return await invoke("app_info");
}
