/** App-wide activity indicator for the status bar; ref-counted so concurrent operations keep "busy" until the last one finishes, and `label` shows the most recently started message. */
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

  return {
    get busy() {
      return depth > 0;
    },
    get label() {
      return label;
    },
    begin,
    end,
  };
}

/** App-wide singleton (tests create their own instance via createActivity). */
export const activity = createActivity();
