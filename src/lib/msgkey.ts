/**
 * Resolve a message key (returned by domain functions) to a localized string
 * via the Paraglide messages namespace. Falls back to the raw key if the key
 * is not found (e.g. legacy prose strings or unknown keys).
 *
 * Usage: import { msgKey } from "$lib/msgkey";
 *        {msgKey(errorKey)}
 */
import * as m from "$lib/paraglide/messages";

const _m = m as unknown as Record<string, (() => string) | undefined>;

export function msgKey(key: string | null | undefined): string {
  if (!key) return "";
  return _m[key]?.() ?? key;
}
