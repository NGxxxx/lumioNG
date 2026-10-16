/** Debounce for "type to filter/search" inputs, shared across the app (grid quick-search,
 *  namespace filter, tree find-field) so they all feel the same and are easy to retune together. */
export const SEARCH_DEBOUNCE_MS = 250;

/** Debounces a burst of calls (e.g. keystrokes) into a single delayed action: `schedule()` cancels
 *  any pending action and re-arms the timer; `cancel()` drops a pending action outright (e.g. on
 *  unmount, or right before running the action immediately instead). */
export function createDebouncer(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(action: () => void) {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      action();
    }, ms);
  }

  return { schedule, cancel };
}

/** Short human duration for timings shown in the UI: "88 ms", "1.2 s", "1 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}
