/** Pure helpers for "last connected" display and ordering. No Tauri, no Svelte. */

export type RelativeParts = { value: number; unit: Intl.RelativeTimeFormatUnit };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** `{ value, unit }` for `Intl.RelativeTimeFormat`, picking the coarsest unit that reads naturally. */
export function relativeParts(ms: number, now: number): RelativeParts {
  const diff = ms - now; // negative = past
  const abs = Math.abs(diff);
  if (abs < MINUTE) return { value: Math.round(diff / 1000), unit: "second" };
  if (abs < HOUR) return { value: Math.round(diff / MINUTE), unit: "minute" };
  if (abs < DAY) return { value: Math.round(diff / HOUR), unit: "hour" };
  if (abs < MONTH) return { value: Math.round(diff / DAY), unit: "day" };
  if (abs < YEAR) return { value: Math.round(diff / MONTH), unit: "month" };
  return { value: Math.round(diff / YEAR), unit: "year" };
}

/** Sort by `lastConnectedAt` descending; never-connected (null/undefined) sink to the end,
 *  each group keeping its original relative order (Array#sort is stable). */
export function sortByRecency<T extends { lastConnectedAt?: number | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const an = a.lastConnectedAt ?? null;
    const bn = b.lastConnectedAt ?? null;
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    return bn - an;
  });
}
