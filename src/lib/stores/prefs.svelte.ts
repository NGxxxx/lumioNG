// Synchronous key-value store for UI preferences with a localStorage-like API.
// The whole file is read once at startup (`hydrate`); writes land in memory at once and are saved
// to prefs.json by Rust, debounced. Without Tauri (tests, plain browser) it is simply in-memory.
import { loadPrefs, savePrefs, exportPrefs, importPrefs } from "../api/prefs";
import { logFrontend } from "../api/diagnostics";
import { MIGRATED_KEY, migrateFromLocalStorage } from "../domain/prefsMigration";

const SAVE_DELAY_MS = 300;

export function createPrefs(saveDelayMs = SAVE_DELAY_MS) {
  let map = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hydrated = false;
  let dirty = false; // changes not yet written
  let loadFailed = false; // prefs.json could not be read: saving would overwrite it with a partial map
  let pending: Promise<void> = Promise.resolve();
  const hydrateCallbacks: Array<() => void> = [];

  function snapshot(): Record<string, string> {
    return Object.fromEntries(map);
  }

  function schedule() {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void flush(), saveDelayMs);
  }

  /** Writes pending changes now (a no-op when nothing changed). Failures are swallowed: the next change retries with the full map. */
  function flush(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Before hydration the map holds only early writes: saving it would replace prefs.json with a partial map.
    // hydrate() schedules a save for those writes once the file has been merged in.
    if (!dirty || loadFailed || !hydrated) return pending;
    dirty = false;
    pending = pending
      .then(() => savePrefs(snapshot()))
      .catch(() => {
        dirty = true;
      });
    return pending;
  }

  function runHydrateCallbacks() {
    for (const cb of hydrateCallbacks) {
      try {
        cb();
      } catch {
        /* one store failing to re-read must not stop the others */
      }
    }
  }

  return {
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
      schedule();
    },
    removeItem(key: string): void {
      if (map.delete(key)) schedule();
    },
    /** Drops every preference except the migration flag (so the old localStorage is not replayed). */
    clear(): void {
      const flag = map.get(MIGRATED_KEY);
      map = new Map();
      if (flag !== undefined) map.set(MIGRATED_KEY, flag);
      schedule();
    },
    /** Stored key names only (for the diagnostics bundle; values never leave). */
    keys(): string[] {
      return [...map.keys()];
    },
    /**
     * Loads prefs.json (migrating the old localStorage settings on first run). Keys written before this
     * completes are kept only when the file lacks them. A load failure leaves the in-memory store usable.
     */
    async hydrate(): Promise<void> {
      let fromFile: Record<string, string> = {};
      try {
        fromFile = await loadPrefs();
      } catch (e) {
        // Keep the unreadable file untouched for the whole session instead of overwriting it with a partial map.
        loadFailed = true;
        void logFrontend("warn", "prefs.json could not be loaded; settings will not be saved this session", String(e)).catch(() => {});
        hydrated = true;
        runHydrateCallbacks();
        return;
      }
      let entries = fromFile;
      let migrated = false;
      try {
        ({ entries, migrated } = migrateFromLocalStorage(localStorage, fromFile));
      } catch {
        /* no localStorage */
      }
      const early = map;
      map = new Map(Object.entries(entries));
      for (const [k, v] of early) if (!map.has(k)) map.set(k, v);
      hydrated = true;
      runHydrateCallbacks();
      if (migrated || early.size > 0 || dirty) schedule();
      if (typeof window !== "undefined") {
        window.addEventListener("pagehide", () => void flush());
        window.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") void flush();
        });
      }
    },
    /**
     * Registers a re-read for a store that was created before hydration finished (module-level
     * singletons are evaluated while the file is still loading). Skipped once hydrated.
     */
    afterHydrate(cb: () => void): void {
      if (!hydrated) hydrateCallbacks.push(cb);
    },
    flush,
    async exportTo(path: string): Promise<void> {
      await flush();
      await exportPrefs(path);
    },
    /** Replaces every preference with the file's; the caller reloads the app to apply them. */
    async importFrom(path: string): Promise<void> {
      await flush(); // the backend merges the CURRENT mcp-* values from disk into the result
      const entries = await importPrefs(path);
      map = new Map(Object.entries(entries));
      map.set(MIGRATED_KEY, "1");
      loadFailed = false; // an explicit import replaces whatever could not be read
      dirty = true;
      await flush();
    },
  };
}

export const prefs = createPrefs();
