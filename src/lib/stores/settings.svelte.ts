import { untrack } from "svelte";

const SUPPRESS_KEY = "suppress-destructive-warning";
const TIMEOUT_KEY = "query-timeout-ms";
const CAP_KEY = "query-result-cap";
const CAP_UNLIMITED_KEY = "query-result-cap-unlimited";
const WRAP_KEY = "wrap-long-lines";
const EDITOR_H_KEY = "query-editor-height-px";

/** Absolute floor (px) for either side of the Query tab's editor/bottom split. */
export const MIN_PANE_PX = 120;

// Defaults mirror the Rust script engine fallbacks (commands/script.rs).
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CAP = 1000;

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Read a positive-integer setting; fall back to `fallback` for missing/invalid values. */
function readPosInt(key: string, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  } catch {
    return fallback;
  }
}

/** Like `readPosInt`, but returns `null` for missing/invalid values instead of a fallback —
 *  `null` means "no user override, use the CSS default". */
function readPosIntOrNull(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

/** App-wide UI preferences persisted in localStorage. */
export function createSettings() {
  const hasStorage = typeof localStorage !== "undefined";
  let suppress = $state<boolean>(hasStorage ? untrack(() => readBool(SUPPRESS_KEY)) : false);
  let timeoutMs = $state<number>(
    hasStorage ? untrack(() => readPosInt(TIMEOUT_KEY, DEFAULT_TIMEOUT_MS)) : DEFAULT_TIMEOUT_MS,
  );
  let cap = $state<number>(hasStorage ? untrack(() => readPosInt(CAP_KEY, DEFAULT_CAP)) : DEFAULT_CAP);
  let capUnlimited = $state<boolean>(hasStorage ? untrack(() => readBool(CAP_UNLIMITED_KEY)) : false);
  let wrapLongLines = $state<boolean>(hasStorage ? untrack(() => readBool(WRAP_KEY)) : false);
  let queryEditorHeightPx = $state<number | null>(
    hasStorage ? untrack(() => readPosIntOrNull(EDITOR_H_KEY)) : null,
  );

  return {
    get suppressDestructiveWarning(): boolean {
      return suppress;
    },
    setSuppressDestructiveWarning(v: boolean) {
      suppress = v;
      writeKey(SUPPRESS_KEY, v ? "true" : "false");
    },
    get queryTimeoutMs(): number {
      return timeoutMs;
    },
    setQueryTimeoutMs(v: number) {
      if (!Number.isFinite(v) || v <= 0) return; // ignore invalid input, keep the current value
      timeoutMs = Math.floor(v);
      writeKey(TIMEOUT_KEY, String(timeoutMs));
    },
    get queryResultCap(): number {
      return cap;
    },
    setQueryResultCap(v: number) {
      if (!Number.isFinite(v) || v <= 0) return;
      cap = Math.floor(v);
      writeKey(CAP_KEY, String(cap));
    },
    /** When true, query runs fetch every matching row (no server-side truncation). */
    get queryResultCapUnlimited(): boolean {
      return capUnlimited;
    },
    setQueryResultCapUnlimited(v: boolean) {
      capUnlimited = v;
      writeKey(CAP_UNLIMITED_KEY, v ? "true" : "false");
    },
    /** When true, long field/document text wraps instead of scrolling horizontally. */
    get wrapLongLines(): boolean {
      return wrapLongLines;
    },
    setWrapLongLines(v: boolean) {
      wrapLongLines = v;
      writeKey(WRAP_KEY, v ? "true" : "false");
    },
    /** Query tab editor height override (px); null = use the CSS default (34%). */
    get queryEditorHeightPx(): number | null {
      return queryEditorHeightPx;
    },
    setQueryEditorHeightPx(px: number) {
      queryEditorHeightPx = Math.max(MIN_PANE_PX, Math.round(px));
      writeKey(EDITOR_H_KEY, String(queryEditorHeightPx));
    },
    resetQueryEditorHeight() {
      queryEditorHeightPx = null;
      try {
        localStorage.removeItem(EDITOR_H_KEY);
      } catch {
        /* storage unavailable — keep the in-memory value */
      }
    },
  };
}

export const settings = createSettings();
