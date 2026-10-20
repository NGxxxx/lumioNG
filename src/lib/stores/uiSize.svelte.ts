import { untrack } from "svelte";
import { UI_SIZES, uiSizePx, type UiSizeKey } from "../domain/uiSize";
import { prefs } from "./prefs.svelte";

const STORAGE_KEY = "ui-size";
const DEFAULT: UiSizeKey = "default";

function readSaved(): UiSizeKey {
  try {
    const v = prefs.getItem(STORAGE_KEY);
    return UI_SIZES.some((s) => s.key === v) ? (v as UiSizeKey) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function applyRootFontSize(key: UiSizeKey) {
  if (typeof document !== "undefined") {
    document.documentElement.style.fontSize = `${uiSizePx(key)}px`;
  }
}

/** Reactive root font-size: changing it rescales every rem-based dimension live. */
export function createUiSize() {
  let current = $state<UiSizeKey>(typeof document !== "undefined" ? readSaved() : DEFAULT);
  untrack(() => applyRootFontSize(current));
  prefs.afterHydrate(() => {
    current = readSaved();
    applyRootFontSize(current);
  });

  return {
    get current(): UiSizeKey {
      return current;
    },
    set(key: UiSizeKey) {
      if (key === current) return;
      current = key;
      applyRootFontSize(key);
      try {
        prefs.setItem(STORAGE_KEY, key);
      } catch {
        /* storage unavailable — keep the in-memory size */
      }
    },
  };
}

export const uiSize = createUiSize();
