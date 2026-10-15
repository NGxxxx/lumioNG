/** Resolve a message key (returned by domain functions) to a localized string via Paraglide, falling back to the raw key if not found. */
import * as m from "#lib/paraglide/messages.js";
import { plural } from "./domain/plural";

const _m = m as unknown as Record<string, ((p?: Record<string, string>) => string) | undefined>;

export function msgKey(key: string | null | undefined, params?: Record<string, string>): string {
  if (!key) return "";
  return _m[key]?.(params) ?? key;
}

/** A counted message: `<key>_one` when `count` is 1 (if that variant exists), else `<key>`.
 *  `{count}` is formatted with thousands separators; extra params are passed through. */
export function msgCount(key: string, count: number, params: Record<string, string> = {}): string {
  const all = { ...params, count: count.toLocaleString("en-US") };
  const other = _m[key];
  if (!other) return key;
  const one = _m[`${key}_one`];
  return plural(count, () => (one ?? other)(all), () => other(all));
}
