export interface LogEntry {
  n: number;
  text: string;
  sessionId: string;
  at: number;
  tookMs: number;
}

/** Longest command text kept per entry; longer ones (e.g. inserting a large document) keep their head. */
export const LOG_TEXT_MAX = 4000;

const clip = (text: string) =>
  text.length > LOG_TEXT_MAX ? `${text.slice(0, LOG_TEXT_MAX)}… (+${(text.length - LOG_TEXT_MAX).toLocaleString("en-US")} chars)` : text;

/** Append-only mongosh command log; retains the N most recent entries. */
export function createCommandLog(limit = 500) {
  // Entries are immutable and the array is always replaced, so no deep proxy is needed.
  let entries = $state.raw<LogEntry[]>([]);
  let counter = 0;
  // Entries pushed since the log was last looked at (drives the status-bar dot).
  let unseen = $state(0);

  function push(text: string, sessionId: string, tookMs: number) {
    counter += 1;
    const next = [...entries, { n: counter, text: clip(text), sessionId, at: Date.now(), tookMs }];
    entries = next.length > limit ? next.slice(next.length - limit) : next;
    unseen += 1;
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
    push,
    pushTimed,
    clear,
    markSeen,
  };
}

/** App-wide singleton (tests create their own instance via createCommandLog). */
export const commandLog = createCommandLog();
