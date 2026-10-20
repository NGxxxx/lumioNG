// One-time move of the old per-webview localStorage settings into the prefs file (pure: storage is passed in).

/** Marks a prefs file as already migrated; kept across "reset to default" so old localStorage is never replayed. */
export const MIGRATED_KEY = "__migrated_v1";

/** Owned by paraglide (its own localStorage strategy), not an app preference. */
const FOREIGN_KEYS = new Set(["PARAGLIDE_LOCALE"]);

/**
 * Copies every localStorage entry the file does not already have. Runs only while the file lacks the
 * `__migrated_v1` flag; unreadable storage yields `migrated: false` so the next start retries.
 */
export function migrateFromLocalStorage(
  ls: Storage,
  existing: Record<string, string>,
): { entries: Record<string, string>; migrated: boolean } {
  if (existing[MIGRATED_KEY] !== undefined) return { entries: existing, migrated: false };
  const entries = { ...existing };
  try {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key === null || FOREIGN_KEYS.has(key) || key in entries) continue;
      const value = ls.getItem(key);
      if (value !== null) entries[key] = value;
    }
  } catch {
    return { entries: existing, migrated: false };
  }
  entries[MIGRATED_KEY] = "1";
  return { entries, migrated: true };
}
