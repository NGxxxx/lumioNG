// src/lib/stores/filterHistory.svelte.ts — last applied filters per connection/db/collection,
// kept in local storage (spec §2.3). Rules (dedupe, cap 10, pinned) live in domain/filterHistory.
import { pushFilter, normalizeFilter, type FilterHistoryEntry } from "../domain/filterHistory";

export const STORAGE_KEY = "lumio.filterHistory.v1";

function readAll(): Record<string, FilterHistoryEntry[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, FilterHistoryEntry[]> = {};
    for (const [ns, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[ns] = list.filter(
        (e): e is FilterHistoryEntry =>
          !!e && typeof e === "object" && typeof (e as FilterHistoryEntry).text === "string" &&
          typeof (e as FilterHistoryEntry).at === "number" && typeof (e as FilterHistoryEntry).pinned === "boolean",
      );
    }
    return out;
  } catch {
    return {};
  }
}

export function createFilterHistory() {
  let all = $state.raw<Record<string, FilterHistoryEntry[]>>(readAll());

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // storage full / unavailable: history just isn't kept
    }
  }

  function entriesFor(ns: string): FilterHistoryEntry[] {
    return all[ns] ?? [];
  }

  /** Called after a filter was applied successfully. */
  function record(ns: string, text: string) {
    const next = pushFilter(entriesFor(ns), text, Date.now());
    if (next === entriesFor(ns)) return;
    all = { ...all, [ns]: next };
    persist();
  }

  function pin(ns: string, text: string, pinned: boolean) {
    const key = normalizeFilter(text);
    all = { ...all, [ns]: entriesFor(ns).map((e) => (normalizeFilter(e.text) === key ? { ...e, pinned } : e)) };
    persist();
  }

  function clear(ns: string) {
    const { [ns]: _, ...rest } = all;
    all = rest;
    persist();
  }

  return { entriesFor, record, pin, clear };
}

/** App-wide singleton. */
export const filterHistory = createFilterHistory();
