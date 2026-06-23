/**
 * App-wide activity indicator for the status bar. Ref-counted so concurrent operations
 * (e.g. paging while an aggregate runs) keep "busy" until the last one finishes; `label`
 * shows the most recently started operation. Callers pass an already-localized message.
 */
export function createActivity() {
  let depth = $state(0);
  let label = $state<string | null>(null);

  function begin(message: string) {
    depth += 1;
    label = message;
  }
  function end() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) label = null;
  }
  /** Run `fn` while showing `message`; always balances begin/end, even on error. */
  async function track<T>(message: string, fn: () => Promise<T>): Promise<T> {
    begin(message);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  return {
    get busy() {
      return depth > 0;
    },
    get label() {
      return label;
    },
    begin,
    end,
    track,
  };
}

/** App-wide singleton (tests create their own instance via createActivity). */
export const activity = createActivity();
