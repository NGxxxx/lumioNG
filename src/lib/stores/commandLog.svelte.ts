import { appendCommandLog, readCommandLog, commandLogDir, clearCommandLogFiles, type LogFileRef } from "../api/commandLog";
import { errorMessage } from "../api/errors";
import { clipText, enforceBudget } from "../domain/commandLogBudget";
import { settings } from "./settings.svelte";
import { sessionMeta } from "./sessionEnv";

export interface LogEntry {
  n: number;
  /** The command text kept in memory: all of it, or its first LOG_PREVIEW characters when `clipped`. */
  text: string;
  /** Length of the full command. */
  length: number;
  clipped: boolean;
  sessionId: string;
  at: number;
  tookMs: number;
  /** Where the full text was written when "save to file" was on. */
  file?: LogFileRef;
}

/** Characters of command text kept in memory across the whole log (~16 MB); beyond it the oldest
 *  commands are cut to a preview. */
export const LOG_CHAR_BUDGET = 8_000_000;
/** A single command longer than this is never held whole (e.g. inserting a huge document). */
export const LOG_ENTRY_MAX = 2_000_000;
export const LOG_PREVIEW = 4000;

export interface CommandLogDeps {
  toFile: () => boolean;
  append: (header: string, text: string) => Promise<LogFileRef>;
  read: (ref: LogFileRef) => Promise<string>;
  label: (sessionId: string) => string;
}

const defaultDeps: CommandLogDeps = {
  toFile: () => settings.commandLogToFile,
  append: appendCommandLog,
  read: readCommandLog,
  label: (id) => sessionMeta(id).label,
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** Local time, as people read it in the file: "2026-10-16 14:03:07.120". */
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Append-only mongosh command log; retains the N most recent entries within a memory budget, and
 *  optionally writes every command in full to disk. */
export function createCommandLog(limit = 500, deps: CommandLogDeps = defaultDeps) {
  // Entries are immutable and the array is always replaced, so no deep proxy is needed.
  let entries = $state.raw<LogEntry[]>([]);
  let counter = 0;
  // Entries pushed since the log was last looked at (drives the status-bar dot).
  let unseen = $state(0);
  let fileError = $state<string | null>(null);

  function push(text: string, sessionId: string, tookMs: number) {
    counter += 1;
    const n = counter;
    const at = Date.now();
    const entry: LogEntry = {
      n, sessionId, at, tookMs,
      text: text.length > LOG_ENTRY_MAX ? clipText(text, LOG_PREVIEW) : text,
      length: text.length,
      clipped: text.length > LOG_ENTRY_MAX,
    };
    const next = [...entries, entry];
    entries = enforceBudget(next.length > limit ? next.slice(next.length - limit) : next, LOG_CHAR_BUDGET, LOG_PREVIEW);
    unseen += 1;
    if (deps.toFile()) void writeToFile(n, text, `${stamp(at)}  ${deps.label(sessionId)}  ${tookMs} ms`);
  }

  async function writeToFile(n: number, text: string, header: string) {
    try {
      const file = await deps.append(header, text);
      entries = entries.map((e) => (e.n === n ? { ...e, file } : e));
      fileError = null;
    } catch (e) {
      fileError = errorMessage(e);
    }
  }

  /** The entry's full command text: from memory, else from the log file. `complete` is false when
   *  only the in-memory preview is left. */
  async function fullText(e: LogEntry): Promise<{ text: string; complete: boolean }> {
    if (!e.clipped) return { text: e.text, complete: true };
    if (e.file) {
      try {
        return { text: await deps.read(e.file), complete: true };
      } catch {
        /* file cleared or rotated away — fall back to the preview */
      }
    }
    return { text: e.text, complete: false };
  }

  function markSeen() {
    unseen = 0;
  }

  /** Run `fn`, measuring its wall-clock duration, then push an entry with that duration.
   *  If `fn` rejects, no entry is pushed and the rejection propagates to the caller. */
  async function pushTimed<T>(text: string, sessionId: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const result = await fn();
    push(text, sessionId, Date.now() - startedAt);
    return result;
  }

  function clear() {
    entries = [];
    unseen = 0;
  }

  return {
    get entries() {
      return entries;
    },
    get unseen() {
      return unseen;
    },
    /** Last failure writing the log file (null once a write succeeds again). */
    get fileError() {
      return fileError;
    },
    push,
    pushTimed,
    fullText,
    clear,
    markSeen,
  };
}

/** Folder holding the daily command log files. */
export const commandLogFolder = () => commandLogDir();

/** Deletes the log files; entries that pointed into them fall back to their in-memory text. */
export async function deleteCommandLogFiles(): Promise<number> {
  return await clearCommandLogFiles();
}

/** App-wide singleton (tests create their own instance via createCommandLog). */
export const commandLog = createCommandLog();
