// src/lib/domain/queryHistory.ts — pure query-history logic (no Svelte, no Tauri).

export type HistoryEntry = {
  id: string;
  tabId: number | null;
  sessionLabel: string;
  connId: number | null;
  db: string;
  script: string;
  at: number;
  ms: number | null;
  outcome: { kind: "docs" | "modified" | "error"; n?: number; message?: string };
  runs: number;
};

export const HISTORY_CAP = 200;

/**
 * Records a run in a newest-first list. If the newest entry of the same (non-null) tab has the exact
 * same script and db, it is updated in place (runs+1, new at/ms/outcome) and moved to the front;
 * otherwise a new entry is prepended. Capped to HISTORY_CAP. Never mutates `list`.
 */
export function recordRun(
  list: HistoryEntry[],
  e: Omit<HistoryEntry, "id" | "runs">,
  newId: () => string,
): HistoryEntry[] {
  let next: HistoryEntry[];
  const i = e.tabId === null ? -1 : list.findIndex((x) => x.tabId === e.tabId);
  if (i !== -1 && list[i].script === e.script && list[i].db === e.db) {
    const merged: HistoryEntry = { ...list[i], ...e, id: list[i].id, runs: list[i].runs + 1 };
    next = [merged, ...list.slice(0, i), ...list.slice(i + 1)];
  } else {
    next = [{ ...e, id: newId(), runs: 1 }, ...list];
  }
  return next.slice(0, HISTORY_CAP);
}

type DayKey = "today" | "yesterday" | "week" | "older";

/** Groups a newest-first list by local calendar day relative to `now`; empty groups are omitted. */
export function groupByDay(list: HistoryEntry[], now: Date): { key: DayKey; entries: HistoryEntry[] }[] {
  const dayNum = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const today = dayNum(now);
  const buckets: Record<DayKey, HistoryEntry[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const e of list) {
    const age = today - dayNum(new Date(e.at));
    const key: DayKey = age <= 0 ? "today" : age === 1 ? "yesterday" : age <= 6 ? "week" : "older";
    buckets[key].push(e);
  }
  return (["today", "yesterday", "week", "older"] as const)
    .filter((k) => buckets[k].length > 0)
    .map((key) => ({ key, entries: buckets[key] }));
}

/** Case-insensitive substring search over script and db, with optional tab / errors-only filters. */
export function searchHistory(
  list: HistoryEntry[],
  q: string,
  opts: { tabId?: number; errorsOnly?: boolean },
): HistoryEntry[] {
  const needle = q.trim().toLowerCase();
  return list.filter((e) => {
    if (opts.tabId !== undefined && e.tabId !== opts.tabId) return false;
    if (opts.errorsOnly && e.outcome.kind !== "error") return false;
    if (needle === "") return true;
    return e.script.toLowerCase().includes(needle) || e.db.toLowerCase().includes(needle);
  });
}

const isNumOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

function validEntry(v: unknown): v is HistoryEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const out = o.outcome as Record<string, unknown> | null;
  return (
    typeof o.id === "string" &&
    isNumOrNull(o.tabId) &&
    typeof o.sessionLabel === "string" &&
    isNumOrNull(o.connId) &&
    typeof o.db === "string" &&
    typeof o.script === "string" &&
    typeof o.at === "number" &&
    Number.isFinite(o.at) &&
    isNumOrNull(o.ms) &&
    typeof o.runs === "number" &&
    typeof out === "object" &&
    out !== null &&
    (out.kind === "docs" || out.kind === "modified" || out.kind === "error") &&
    (out.n === undefined || typeof out.n === "number") &&
    (out.message === undefined || typeof out.message === "string")
  );
}

/** Tolerant parse of the persisted history; never throws, drops malformed entries. */
export function parseStoredHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(validEntry).slice(0, HISTORY_CAP);
  } catch {
    return [];
  }
}
