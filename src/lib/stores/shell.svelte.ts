import { untrack } from "svelte";
import { prefs } from "./prefs.svelte";

const SQ_OPEN_KEY = "saved-queries-open";
const SQ_HEIGHT_KEY = "saved-queries-height-px";

function readStored(key: string): string | null {
  try {
    return prefs.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    prefs.setItem(key, value);
  } catch {
    /* storage unavailable — keep the in-memory value */
  }
}

/** App chrome state: active connection and sidebar/log dimensions (db/collection counts are derived per-session in the page, not here). */
export function createShell() {
  let connection = $state<{ label: string; uri: string } | null>(null);
  let connectedAt = $state<number | null>(null); // epoch ms of the active connection (status-bar clock)
  // Starts hidden: the startup restore offer decides whether the manager opens (see workspaceRestore `onSettled`), so it never flashes.
  let sessionOpen = $state(false);
  let sidebarWidth = $state(240);
  let logOpen = $state(false); // closed by default; the status bar shows a dot when commands arrive
  let logHeight = $state(140);
  // Saved-queries sidebar section: the only shell fields persisted across restarts.
  const readSavedQueriesOpen = () => readStored(SQ_OPEN_KEY) !== "false";
  const readSavedQueriesHeight = () => {
    const n = Number(readStored(SQ_HEIGHT_KEY));
    return Number.isFinite(n) && n > 0 ? Math.min(500, Math.max(80, Math.round(n))) : 180;
  };
  let savedQueriesOpen = $state(untrack(readSavedQueriesOpen));
  let savedQueriesHeight = $state(untrack(readSavedQueriesHeight));
  prefs.afterHydrate(() => {
    savedQueriesOpen = readSavedQueriesOpen();
    savedQueriesHeight = readSavedQueriesHeight();
  });

  function setConnection(c: { label: string; uri: string } | null) {
    connection = c;
    connectedAt = c ? Date.now() : null;
  }
  function toggleSession() {
    sessionOpen = !sessionOpen;
  }
  function openSession() {
    sessionOpen = true;
  }
  function toggleLog() {
    logOpen = !logOpen;
  }
  function setSidebarWidth(w: number) {
    sidebarWidth = Math.max(160, Math.min(600, Math.round(w)));
  }
  function setLogHeight(h: number) {
    logHeight = Math.max(60, Math.min(500, Math.round(h)));
  }
  function toggleSavedQueries() {
    savedQueriesOpen = !savedQueriesOpen;
    writeStored(SQ_OPEN_KEY, savedQueriesOpen ? "true" : "false");
  }
  function setSavedQueriesHeight(h: number) {
    savedQueriesHeight = Math.max(80, Math.min(500, Math.round(h)));
    writeStored(SQ_HEIGHT_KEY, String(savedQueriesHeight));
  }

  return {
    get connection() {
      return connection;
    },
    get connectedAt() {
      return connectedAt;
    },
    get sessionOpen() {
      return sessionOpen;
    },
    get sidebarWidth() {
      return sidebarWidth;
    },
    get logOpen() {
      return logOpen;
    },
    get logHeight() {
      return logHeight;
    },
    get savedQueriesOpen() { return savedQueriesOpen; },
    get savedQueriesHeight() { return savedQueriesHeight; },
    setConnection,
    toggleSession,
    openSession,
    toggleLog,
    setSidebarWidth,
    setLogHeight,
    toggleSavedQueries,
    setSavedQueriesHeight,
  };
}

/** App-wide singleton (tests create their own instance via createShell). */
export const shell = createShell();
