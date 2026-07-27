import { SHOW_ALL_WARN_THRESHOLD } from "../domain/paging";
import { errorMessage } from "../api/errors";
import { activity } from "./activity.svelte";

/** Shared "Show ALL" flow for the collection grid and the Query tab's result grid: the same
 *  threshold-gated confirmation plus the same generation guard, so a superseded call can never
 *  clobber a fresher one — and a fix here lands on both call sites at once. */
export function createShowAllFlow(opts: {
  /** Kept fresh by the owning store, so Show ALL gates off it instead of re-counting. */
  getTotalCount: () => number;
  /** Bumps the owning store's `generation` (dropping any open cell edit) and returns the new value. */
  bumpGeneration: () => number;
  /** Reads the owning store's current `generation`, to detect a superseded run after an await. */
  currentGeneration: () => number;
  /** Optional gate: false makes Show ALL a no-op (a fixed-limit cursor has nothing to expand). */
  canShowAll?: () => boolean;
  /** `null` clears the last error before starting; a string reports a failed load. */
  setError: (message: string | null) => void;
  setLoading: (v: boolean) => void;
  /** Status-bar label while loading; omit to keep the fetch out of the activity indicator. */
  activityLabel?: () => string;
  /** Fetch every matching row and apply it; must re-check `stale()` after each await before writing. */
  load: (stale: () => boolean) => Promise<void>;
}) {
  let showAllPending = $state<number | null>(null);

  function requestShowAll(): void | Promise<void> {
    if (opts.canShowAll && !opts.canShowAll()) return;
    opts.setError(null);
    const total = opts.getTotalCount();
    if (total > SHOW_ALL_WARN_THRESHOLD) {
      opts.bumpGeneration(); // invalidate any other in-flight load — this supersedes it
      showAllPending = total;
      return;
    }
    return confirmShowAll();
  }

  /** Self-guarding: bumps `generation` so a second call (or any other in-flight load) discards a
   *  stale first call. */
  async function confirmShowAll(): Promise<void> {
    showAllPending = null;
    opts.setError(null);
    const gen = opts.bumpGeneration();
    const stale = () => gen !== opts.currentGeneration();
    opts.setLoading(true);
    const label = opts.activityLabel?.();
    if (label !== undefined) activity.begin(label);
    try {
      await opts.load(stale);
    } catch (e) {
      if (!stale()) opts.setError(errorMessage(e));
    } finally {
      if (!stale()) opts.setLoading(false);
      if (label !== undefined) activity.end();
    }
  }

  function cancelShowAll() {
    showAllPending = null;
  }

  return {
    get showAllPending() {
      return showAllPending;
    },
    requestShowAll,
    confirmShowAll,
    cancelShowAll,
  };
}
