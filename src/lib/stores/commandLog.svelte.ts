export interface LogEntry {
  n: number;
  text: string;
  sessionId: string;
  at: number;
  tookMs: number;
}

/** Append-only mongosh command log; retains the N most recent entries. */
export function createCommandLog(limit = 500) {
  let entries = $state<LogEntry[]>([]);
  let open = $state(true);
  let counter = 0;

  function push(text: string, sessionId: string, tookMs: number) {
    counter += 1;
    const next = [...entries, { n: counter, text, sessionId, at: Date.now(), tookMs }];
    entries = next.length > limit ? next.slice(next.length - limit) : next;
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
  }

  function toggle() {
    open = !open;
  }

  return {
    get entries() {
      return entries;
    },
    get open() {
      return open;
    },
    push,
    pushTimed,
    clear,
    toggle,
  };
}

/** App-wide singleton (tests create their own instance via createCommandLog). */
export const commandLog = createCommandLog();
