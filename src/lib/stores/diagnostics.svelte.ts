import { logFrontend, takeCrashReports, openCrashFolder, exportDiagnostics, type CrashReport } from "../api/diagnostics";
import { errorMessage } from "../api/errors";
import { readTextFileIfExists } from "../api/files";
import { prefs } from "./prefs.svelte";

/** Crash reports from a previous run, shown once at startup (reports stay on this machine). */
export function createCrashReports() {
  let reports = $state.raw<CrashReport[]>([]);

  async function load() {
    try {
      reports = await takeCrashReports();
    } catch {
      reports = []; // outside the desktop shell, or logging unavailable: no dialog
    }
  }

  /** Full text of every pending report, newest last — what "Copy" puts on the clipboard. */
  async function reportText(): Promise<string> {
    const parts: string[] = [];
    for (const r of reports) {
      const text = await readTextFileIfExists(r.file).catch(() => null);
      parts.push(text ?? r.summary);
    }
    return parts.join("\n\n----\n\n");
  }

  return {
    get reports() { return reports; },
    load,
    reportText,
    openFolder: () => openCrashFolder().catch(() => {}),
    dismiss() { reports = []; },
  };
}

/** Forwards uncaught frontend errors to the app log file. Returns an uninstall function. */
export function installErrorLogging(target: Window = window): () => void {
  const send = (message: string, context?: string) => void logFrontend("error", message, context).catch(() => {});
  const onError = (e: ErrorEvent) =>
    send(e.message || "Uncaught error", [e.filename && `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack].filter(Boolean).join("\n") || undefined);
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason;
    send(`Unhandled rejection: ${errorMessage(r)}`, r instanceof Error ? r.stack : undefined);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Saves the diagnostics bundle to `path`; resolves to an error message, or null on success. */
export async function saveDiagnostics(path: string): Promise<string | null> {
  try {
    await exportDiagnostics(path, prefs.keys()); // names only; values never leave the app
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}
