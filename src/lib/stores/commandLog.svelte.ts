export interface LogEntry {
  n: number;
  text: string;
  sessionId: string;
}

/** Append-only mongosh command log; retains the N most recent entries. */
export function createCommandLog(limit = 500) {
  let entries = $state<LogEntry[]>([]);
  let open = $state(true);
  let counter = 0;

  function push(text: string, sessionId: string) {
    counter += 1;
    const next = [...entries, { n: counter, text, sessionId }];
    entries = next.length > limit ? next.slice(next.length - limit) : next;
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
    clear,
    toggle,
  };
}

/** App-wide singleton (tests create their own instance via createCommandLog). */
export const commandLog = createCommandLog();
