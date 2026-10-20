import { untrack } from "svelte";
import { prefs } from "./prefs.svelte";

export type ThemeKey = "latte" | "mocha";

const STORAGE_KEY = "theme";
const DEFAULT: ThemeKey = "mocha";

function readSaved(): ThemeKey {
  try {
    const v = prefs.getItem(STORAGE_KEY);
    return v === "latte" || v === "mocha" ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function applyDataTheme(key: ThemeKey) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = key;
  }
}

/** Reactive light/dark theme: changing it retheme's every CSS var live via the data-theme attribute. */
export function createTheme() {
  let current = $state<ThemeKey>(typeof document !== "undefined" ? readSaved() : DEFAULT);
  untrack(() => applyDataTheme(current));
  prefs.afterHydrate(() => {
    current = readSaved();
    applyDataTheme(current);
  });

  return {
    get current(): ThemeKey {
      return current;
    },
    set(key: ThemeKey) {
      if (key === current) return;
      current = key;
      applyDataTheme(key);
      try {
        prefs.setItem(STORAGE_KEY, key);
      } catch {
        /* storage unavailable — keep the in-memory theme */
      }
    },
  };
}

export const theme = createTheme();
