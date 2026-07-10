/** Resolve a message key (returned by domain functions) to a localized string via Paraglide, falling back to the raw key if not found. */
import * as m from "$lib/paraglide/messages";

const _m = m as unknown as Record<string, (() => string) | undefined>;

export function msgKey(key: string | null | undefined): string {
  if (!key) return "";
  return _m[key]?.() ?? key;
}
