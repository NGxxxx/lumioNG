import { untrack } from "svelte";

const SUPPRESS_KEY = "suppress-destructive-warning";

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** App-wide UI preferences persisted in localStorage. */
export function createSettings() {
  let suppress = $state<boolean>(
    typeof localStorage !== "undefined" ? untrack(() => readBool(SUPPRESS_KEY)) : false,
  );

  return {
    get suppressDestructiveWarning(): boolean {
      return suppress;
    },
    setSuppressDestructiveWarning(v: boolean) {
      suppress = v;
      try {
        localStorage.setItem(SUPPRESS_KEY, v ? "true" : "false");
      } catch {
        /* storage unavailable — keep the in-memory value */
      }
    },
  };
}

export const settings = createSettings();
