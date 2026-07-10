/** App chrome state: active connection and sidebar/log dimensions (db/collection counts are derived per-session in the page, not here). */
export function createShell() {
  let connection = $state<{ label: string; uri: string } | null>(null);
  let connectedAt = $state<number | null>(null); // epoch ms of the active connection (status-bar clock)
  let sessionOpen = $state(true);
  let sidebarWidth = $state(240);
  let logOpen = $state(true);
  let logHeight = $state(140);

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
    setConnection,
    toggleSession,
    openSession,
    toggleLog,
    setSidebarWidth,
    setLogHeight,
  };
}

/** App-wide singleton (tests create their own instance via createShell). */
export const shell = createShell();
