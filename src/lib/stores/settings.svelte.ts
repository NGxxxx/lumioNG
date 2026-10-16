import { untrack } from "svelte";

const SUPPRESS_KEY = "suppress-destructive-warning";
const TIMEOUT_KEY = "query-timeout-ms";
const CAP_KEY = "query-result-cap";
const CAP_UNLIMITED_KEY = "query-result-cap-unlimited";
const WRAP_KEY = "wrap-long-lines";
const STAGE_EDITS_KEY = "stage-cell-edits";
const EDITOR_H_KEY = "query-editor-height-px";
const GRID_DEPTH_KEY = "grid-max-depth";
const SHOW_SYSTEM_DBS_KEY = "show-system-databases";
const DENSITY_KEY = "grid-density";
const PEEK_WIDTH_KEY = "peek-width";
const PEEK_PINNED_KEY = "peek-pinned";
/** Quick-look drawer width bounds (px); the 50%-of-grid maximum is applied by the component. */
export const PEEK_MIN_W = 280;
const PEEK_DEFAULT_W = 360;

/** Grid row density (row heights live in components/gridInteractions.svelte.ts). */
export type Density = "compact" | "comfortable" | "spacious";
const DENSITIES: readonly Density[] = ["compact", "comfortable", "spacious"];

function readDensity(): Density {
  try {
    const v = localStorage.getItem(DENSITY_KEY);
    return (DENSITIES as readonly string[]).includes(v ?? "") ? (v as Density) : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Absolute floor (px) for either side of the Query tab's editor/bottom split. */
export const MIN_PANE_PX = 120;

// Defaults mirror the Rust script engine fallbacks (commands/script.rs).
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_CAP = 1000;
const DEFAULT_GRID_DEPTH = 1;

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

/** Read the grid depth setting: positive int, "all" → null (unlimited), anything else → default 1. */
function readGridDepth(): number | null {
  try {
    const raw = localStorage.getItem(GRID_DEPTH_KEY);
    if (raw === "all") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_GRID_DEPTH;
  } catch {
    return DEFAULT_GRID_DEPTH;
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

const RECORD_HISTORY_KEY = "lumio.recordQueryHistory";

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
  let stageCellEdits = $state<boolean>(hasStorage ? untrack(() => readBool(STAGE_EDITS_KEY)) : false);
  let queryEditorHeightPx = $state<number | null>(
    hasStorage ? untrack(() => readPosIntOrNull(EDITOR_H_KEY)) : null,
  );
  let gridMaxDepth = $state<number | null>(
    hasStorage ? untrack(() => readGridDepth()) : DEFAULT_GRID_DEPTH,
  );
  let showSystemDatabases = $state<boolean>(hasStorage ? untrack(() => readBool(SHOW_SYSTEM_DBS_KEY)) : false);
  let density = $state<Density>(hasStorage ? untrack(readDensity) : "comfortable");
  let peekWidth = $state<number>(
    hasStorage ? untrack(() => Math.max(PEEK_MIN_W, readPosInt(PEEK_WIDTH_KEY, PEEK_DEFAULT_W))) : PEEK_DEFAULT_W,
  );
  let peekPinned = $state<boolean>(hasStorage ? untrack(() => readBool(PEEK_PINNED_KEY)) : false);
  // On unless explicitly turned off (spec §3.1).
  let recordQueryHistory = $state<boolean>(hasStorage ? untrack(() => localStorage.getItem(RECORD_HISTORY_KEY) !== "false") : true);

  return {
    get recordQueryHistory(): boolean {
      return recordQueryHistory;
    },
    setRecordQueryHistory(v: boolean) {
      recordQueryHistory = v;
      writeKey(RECORD_HISTORY_KEY, v ? "true" : "false");
    },
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
    /** When true, collection grid cell edits wait for an explicit Commit instead of saving at once. */
    get stageCellEdits(): boolean {
      return stageCellEdits;
    },
    setStageCellEdits(v: boolean) {
      stageCellEdits = v;
      writeKey(STAGE_EDITS_KEY, v ? "true" : "false");
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
    /** Max nesting depth flattened into grid columns; null = unlimited (All). */
    get gridMaxDepth(): number | null {
      return gridMaxDepth;
    },
    setGridMaxDepth(v: number | null) {
      if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
      gridMaxDepth = v === null ? null : Math.floor(v);
      writeKey(GRID_DEPTH_KEY, gridMaxDepth === null ? "all" : String(gridMaxDepth));
    },
    /** When true, the sidebar tree and Database tab also list MongoDB's own admin/local/config databases. */
    get showSystemDatabases(): boolean {
      return showSystemDatabases;
    },
    setShowSystemDatabases(v: boolean) {
      showSystemDatabases = v;
      writeKey(SHOW_SYSTEM_DBS_KEY, v ? "true" : "false");
    },
    get density(): Density {
      return density;
    },
    setDensity(d: Density) {
      density = d;
      writeKey(DENSITY_KEY, d);
    },
    get peekWidth(): number {
      return peekWidth;
    },
    setPeekWidth(px: number) {
      peekWidth = Math.max(PEEK_MIN_W, Math.round(px));
      writeKey(PEEK_WIDTH_KEY, String(peekWidth));
    },
    get peekPinned(): boolean {
      return peekPinned;
    },
    setPeekPinned(v: boolean) {
      peekPinned = v;
      writeKey(PEEK_PINNED_KEY, v ? "true" : "false");
    },
  };
}

export const settings = createSettings();
