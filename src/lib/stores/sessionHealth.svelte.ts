import type { SessionStatus } from "./sessionManager.svelte";

/** How often open sessions are pinged. */
export const PING_INTERVAL_MS = 30_000;
/** Consecutive failed pings before the session is actively reconnected (the driver recovers topology changes on its own). */
export const RECONNECT_AFTER_FAILURES = 3;

/** Waits before each retry of a session that was connected and then lost; the last value repeats (max 5 min). */
export const RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

/** Why a session went degraded, when the ping error says so. */
export interface DegradedCause {
  /** `host:port` of the SSH server, when the session's SSH tunnel is what is down. */
  sshEndpoint?: string;
}

export interface HealthSession {
  id: string;
  status: SessionStatus;
}

export interface SessionHealthDeps {
  ping: (sessionId: string) => Promise<void>;
  /** The currently open sessions; a session that disappears from this list is no longer pinged. */
  sessions: () => HealthSession[];
  setStatus: (sessionId: string, status: "connected" | "degraded") => void;
  reconnect: (sessionId: string) => Promise<unknown>;
  /** Called once when a healthy session turns degraded (shows the toast). */
  onDegraded?: (sessionId: string, cause: DegradedCause) => void;
  intervalMs?: number;
  failureThreshold?: number;
  retryBackoffMs?: number[];
  /** Receives `online` (default: `window`). */
  win?: EventTarget | null;
  /** Receives `visibilitychange` (default: `document`). */
  doc?: (EventTarget & { visibilityState?: string }) | null;
}

/** Watches the open sessions: pings them on a timer and when the machine wakes or the network returns. */
export function createSessionHealth(deps: SessionHealthDeps) {
  const interval = deps.intervalMs ?? PING_INTERVAL_MS;
  const threshold = deps.failureThreshold ?? RECONNECT_AFTER_FAILURES;
  const backoff = deps.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const failures = new Map<string, number>();
  /** Sessions that were connected, then lost: reconnect is retried until they recover or are closed. */
  const lost = new Map<string, { attempts: number; timer: ReturnType<typeof setTimeout> | null }>();
  const reconnecting = new Set<string>();
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let detach: (() => void) | null = null;

  const current = (id: string) => deps.sessions().find((s) => s.id === id);

  async function check(id: string): Promise<void> {
    if (inFlight.has(id)) return;
    inFlight.add(id);
    try {
      let ok = true;
      let cause: DegradedCause = {};
      try {
        await deps.ping(id);
      } catch (e) {
        ok = false;
        const err = e as { kind?: string; message?: string } | null;
        if (err?.kind === "SshTunnel" && err.message) cause = { sshEndpoint: err.message };
      }
      const s = current(id);
      if (!s) { failures.delete(id); return; } // closed while the ping was running
      if (s.status !== "connected" && s.status !== "degraded") return; // a reconnect is already under way
      if (ok) {
        failures.delete(id);
        if (s.status === "degraded") deps.setStatus(id, "connected");
        return;
      }
      const n = (failures.get(id) ?? 0) + 1;
      failures.set(id, n);
      if (s.status === "connected") {
        deps.setStatus(id, "degraded");
        deps.onDegraded?.(id, cause);
      }
      if (n >= threshold) {
        failures.delete(id);
        await reconnectNow(id);
      }
    } finally {
      inFlight.delete(id);
    }
  }

  function forget(id: string) {
    const l = lost.get(id);
    if (l?.timer) clearTimeout(l.timer);
    lost.delete(id);
  }

  /**
   * Reconnects a session unless a reconnect is already running for it. A session that is still
   * down afterwards stays under supervision: it is retried with backoff, and at once when the
   * network returns or the window becomes visible. Closing the session ends the supervision.
   */
  async function reconnectNow(id: string): Promise<void> {
    if (reconnecting.has(id)) return;
    const before = current(id);
    if (!before || before.status === "connecting") return;
    reconnecting.add(id);
    const entry = lost.get(id) ?? { attempts: 0, timer: null };
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    lost.set(id, entry);
    try {
      await deps.reconnect(id);
    } catch {
      /* the session manager reports failure through the status */
    } finally {
      reconnecting.delete(id);
    }
    const after = current(id);
    if (!after) { forget(id); return; } // closed meanwhile
    if (after.status === "error") {
      const delay = backoff[Math.min(entry.attempts, backoff.length - 1)];
      entry.attempts += 1;
      entry.timer = setTimeout(() => void retryLost(id), delay);
    } else {
      forget(id);
      failures.delete(id);
    }
  }

  async function retryLost(id: string): Promise<void> {
    const l = lost.get(id);
    if (!l) return;
    l.timer = null;
    const s = current(id);
    if (!s || s.status !== "error") { forget(id); return; } // closed, or the user reconnected it themselves
    await reconnectNow(id);
  }

  /** Pings every connected or degraded session once. */
  async function checkAll(resume = false): Promise<void> {
    const open = deps.sessions();
    for (const id of [...failures.keys()]) if (!open.some((s) => s.id === id)) failures.delete(id);
    for (const id of [...lost.keys()]) if (!open.some((s) => s.id === id)) forget(id);
    // The network is back / the machine woke up: do not wait for the backoff timer.
    if (resume) for (const id of [...lost.keys()]) if (current(id)?.status === "error" && !reconnecting.has(id)) void reconnectNow(id);
    await Promise.all(open.filter((s) => s.status === "connected" || s.status === "degraded").map((s) => check(s.id)));
  }

  function start(): () => void {
    stop();
    timer = setInterval(() => void checkAll(), interval);
    const win = deps.win === undefined ? (typeof window === "undefined" ? null : window) : deps.win;
    const doc = deps.doc === undefined ? (typeof document === "undefined" ? null : document) : deps.doc;
    const onOnline = () => void checkAll(true);
    const onVisible = () => { if (doc?.visibilityState === "visible") void checkAll(true); };
    win?.addEventListener("online", onOnline);
    doc?.addEventListener("visibilitychange", onVisible);
    detach = () => {
      win?.removeEventListener("online", onOnline);
      doc?.removeEventListener("visibilitychange", onVisible);
    };
    return stop;
  }

  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    detach?.();
    detach = null;
    for (const id of [...lost.keys()]) forget(id);
  }

  return { start, stop, check, checkAll, reconnectNow };
}
