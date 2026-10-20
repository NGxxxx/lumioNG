import { untrack } from "svelte";
import { prefs } from "./prefs.svelte";

const SUPPRESS_KEY = "suppress-destructive-warning";
const TIMEOUT_KEY = "query-timeout-ms";
const CAP_KEY = "query-result-cap";
const CAP_UNLIMITED_KEY = "query-result-cap-unlimited";
const WRAP_KEY = "wrap-long-lines";
const STAGE_EDITS_KEY = "stage-cell-edits";
const EXPORT_FORMAT_KEY = "export-format";
const COMMAND_LOG_FILE_KEY = "command-log-to-file";
const EXPORT_METADATA_KEY = "export-include-metadata";
const EXPORT_FORMATS = ["json", "csv", "bson", "sql"] as const;
export type ExportFormatPref = (typeof EXPORT_FORMATS)[number];
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
    const v = prefs.getItem(DENSITY_KEY);
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
    return prefs.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Read a positive-integer setting; fall back to `fallback` for missing/invalid values. */
function readPosInt(key: string, fallback: number): number {
  try {
    const n = Number(prefs.getItem(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  } catch {
    return fallback;
  }
}

/** Like `readPosInt`, but returns `null` for missing/invalid values instead of a fallback —
 *  `null` means "no user override, use the CSS default". */
function readPosIntOrNull(key: string): number | null {
  try {
    const n = Number(prefs.getItem(key));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/** Read the grid depth setting: positive int, "all" → null (unlimited), anything else → default 1. */
function readGridDepth(): number | null {
  try {
    const raw = prefs.getItem(GRID_DEPTH_KEY);
    if (raw === "all") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_GRID_DEPTH;
  } catch {
    return DEFAULT_GRID_DEPTH;
  }
}

function writeKey(key: string, value: string) {
  try {
    prefs.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

const RECORD_HISTORY_KEY = "lumio.recordQueryHistory";

function readExportFormat(): ExportFormatPref {
  const v = prefs.getItem(EXPORT_FORMAT_KEY) ?? "";
  return (EXPORT_FORMATS as readonly string[]).includes(v) ? (v as ExportFormatPref) : "json";
}

/** App-wide UI preferences persisted in the prefs store (prefs.json). */
export function createSettings() {
  let suppress = $state<boolean>(untrack(() => readBool(SUPPRESS_KEY)));
  let timeoutMs = $state<number>(untrack(() => readPosInt(TIMEOUT_KEY, DEFAULT_TIMEOUT_MS)));
  let cap = $state<number>(untrack(() => readPosInt(CAP_KEY, DEFAULT_CAP)));
  let capUnlimited = $state<boolean>(untrack(() => readBool(CAP_UNLIMITED_KEY)));
  let wrapLongLines = $state<boolean>(untrack(() => readBool(WRAP_KEY)));
  let stageCellEdits = $state<boolean>(untrack(() => readBool(STAGE_EDITS_KEY)));
  let exportFormat = $state<ExportFormatPref>(untrack(readExportFormat));
  let exportIncludeMetadata = $state<boolean>(untrack(() => readBool(EXPORT_METADATA_KEY)));
  let commandLogToFile = $state<boolean>(untrack(() => readBool(COMMAND_LOG_FILE_KEY)));
  let queryEditorHeightPx = $state<number | null>(untrack(() => readPosIntOrNull(EDITOR_H_KEY)));
  let gridMaxDepth = $state<number | null>(untrack(() => readGridDepth()));
  let showSystemDatabases = $state<boolean>(untrack(() => readBool(SHOW_SYSTEM_DBS_KEY)));
  let density = $state<Density>(untrack(readDensity));
  let peekWidth = $state<number>(untrack(() => Math.max(PEEK_MIN_W, readPosInt(PEEK_WIDTH_KEY, PEEK_DEFAULT_W))));
  let peekPinned = $state<boolean>(untrack(() => readBool(PEEK_PINNED_KEY)));
  // On unless explicitly turned off (spec §3.1).
  let recordQueryHistory = $state<boolean>(untrack(() => prefs.getItem(RECORD_HISTORY_KEY) !== "false"));

  // The singleton is created while prefs.json is still loading; re-read everything once it is in.
  prefs.afterHydrate(() => {
    suppress = readBool(SUPPRESS_KEY);
    timeoutMs = readPosInt(TIMEOUT_KEY, DEFAULT_TIMEOUT_MS);
    cap = readPosInt(CAP_KEY, DEFAULT_CAP);
    capUnlimited = readBool(CAP_UNLIMITED_KEY);
    wrapLongLines = readBool(WRAP_KEY);
    stageCellEdits = readBool(STAGE_EDITS_KEY);
    exportFormat = readExportFormat();
    exportIncludeMetadata = readBool(EXPORT_METADATA_KEY);
    commandLogToFile = readBool(COMMAND_LOG_FILE_KEY);
    queryEditorHeightPx = readPosIntOrNull(EDITOR_H_KEY);
    gridMaxDepth = readGridDepth();
    showSystemDatabases = readBool(SHOW_SYSTEM_DBS_KEY);
    density = readDensity();
    peekWidth = Math.max(PEEK_MIN_W, readPosInt(PEEK_WIDTH_KEY, PEEK_DEFAULT_W));
    peekPinned = readBool(PEEK_PINNED_KEY);
    recordQueryHistory = prefs.getItem(RECORD_HISTORY_KEY) !== "false";
  });

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
    /** The export dialog starts from the format and metadata choice used last time. */
    get exportFormat(): ExportFormatPref {
      return exportFormat;
    },
    get exportIncludeMetadata(): boolean {
      return exportIncludeMetadata;
    },
    setExportPrefs(format: ExportFormatPref, includeMetadata: boolean) {
      exportFormat = format;
      exportIncludeMetadata = includeMetadata;
      writeKey(EXPORT_FORMAT_KEY, format);
      writeKey(EXPORT_METADATA_KEY, includeMetadata ? "true" : "false");
    },
    /** When true, every command's full text is also appended to a daily file on disk. */
    get commandLogToFile(): boolean {
      return commandLogToFile;
    },
    setCommandLogToFile(v: boolean) {
      commandLogToFile = v;
      writeKey(COMMAND_LOG_FILE_KEY, v ? "true" : "false");
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
        prefs.removeItem(EDITOR_H_KEY);
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
