// src/lib/domain/aboutInfo.ts — the About dialog's build facts as people read them, and as one
// copyable block for bug reports. Pure.
export type AppInfo = {
  version: string;
  commit: string;
  buildDate: string;
  os: string;
  arch: string;
  webview: string | null;
};

/** Public repository; the opener capability scopes external links to this prefix. */
export const REPO_URL = "https://github.com/NGxxxx/lumioNG";

/** "github.com/NGxxxx/lumioNG" — the link text, without the scheme. */
export const REPO_LABEL = REPO_URL.replace(/^https:\/\//, "");

/** Donation pages; both are allowed by the opener capability. */
export const KOFI_URL = "https://ko-fi.com/ngxxxx";
export const SPONSOR_URL = "https://github.com/sponsors/NGxxxx";

const OS: Record<string, string> ={ windows: "Windows", macos: "macOS", linux: "Linux" };
const ARCH: Record<string, string> = { x86_64: "x64", aarch64: "ARM64", x86: "x86" };

/** "Windows · x64" */
export function platformLabel(os: string, arch: string): string {
  return `${OS[os] ?? os} · ${ARCH[arch] ?? arch}`;
}

/** The engine behind the window for this OS (WebView2 / WebKit). */
export function webviewName(os: string): string {
  return os === "windows" ? "WebView2" : "WebKit";
}

/** Plain text pasted into an issue: one fact per line, no translation (maintainers read it). */
export function infoText(i: AppInfo): string {
  return [
    `LumioNG ${i.version}`,
    `Build: ${i.commit} (${i.buildDate})`,
    `Platform: ${platformLabel(i.os, i.arch)}`,
    `${webviewName(i.os)}: ${i.webview ?? "unknown"}`,
  ].join("\n");
}
