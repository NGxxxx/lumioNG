// src/lib/stores/queryHistory.svelte.ts — what the user ran in query tabs (spec §3.1), kept locally.
// Rules (merge, cap, tolerant parsing) live in domain/queryHistory.
import { recordRun, parseStoredHistory, type HistoryEntry } from "../domain/queryHistory";
import { settings } from "./settings.svelte";
import { prefs } from "./prefs.svelte";

export const QUERY_HISTORY_KEY = "lumio.queryHistory.v1";

function read(): HistoryEntry[] {
  try {
    return parseStoredHistory(prefs.getItem(QUERY_HISTORY_KEY));
  } catch {
    return [];
  }
}

export function createQueryHistory() {
  let entries = $state.raw<HistoryEntry[]>(read());
  let seq = Date.now();
  prefs.afterHydrate(() => (entries = read()));

  function persist() {
    try {
      prefs.setItem(QUERY_HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // storage full / unavailable: history just isn't kept
    }
  }

  /** One user-initiated run; ignored when "Record query history" is off. */
  function record(e: Omit<HistoryEntry, "id" | "runs">) {
    if (!settings.recordQueryHistory) return;
    entries = recordRun(entries, e, () => `h${(seq++).toString(36)}`);
    persist();
  }

  function clear() {
    entries = [];
    persist();
  }

  return {
    get entries() { return entries; },
    record,
    clear,
  };
}

/** App-wide singleton. */
export const queryHistory = createQueryHistory();
