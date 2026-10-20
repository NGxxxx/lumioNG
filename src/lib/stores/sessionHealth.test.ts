import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSessionHealth, type HealthSession } from "./sessionHealth.svelte";

function setup(opts: { ping?: (id: string) => Promise<void> } = {}) {
  let sessions: HealthSession[] = [{ id: "a", status: "connected" }];
  const ping = vi.fn(opts.ping ?? (async () => {}));
  const reconnect = vi.fn(async (id: string) => {
    sessions = sessions.map((s) => (s.id === id ? { ...s, status: "connected" as const } : s));
  });
  const onDegraded = vi.fn();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const health = createSessionHealth({
    ping,
    sessions: () => sessions,
    setStatus: (id, status) => { sessions = sessions.map((s) => (s.id === id ? { ...s, status } : s)); },
    reconnect,
    onDegraded,
    win,
    doc,
  });
  return { health, ping, reconnect, onDegraded, win, doc, get sessions() { return sessions; }, set sessions(v: HealthSession[]) { sessions = v; } };
}

describe("createSessionHealth", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pings every open session each 30 seconds", async () => {
    const t = setup();
    t.health.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.ping).toHaveBeenCalledTimes(1);
    expect(t.ping).toHaveBeenCalledWith("a");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.ping).toHaveBeenCalledTimes(2);
    t.health.stop();
  });

  it("marks_degraded_after_failed_ping", async () => {
    const t = setup({ ping: async () => { throw new Error("down"); } });
    await t.health.checkAll();
    expect(t.sessions[0].status).toBe("degraded");
    expect(t.onDegraded).toHaveBeenCalledTimes(1);
    expect(t.reconnect).not.toHaveBeenCalled();
    // A second failure does not announce it again.
    await t.health.checkAll();
    expect(t.onDegraded).toHaveBeenCalledTimes(1);
  });

  it("recovers to connected when a later ping succeeds", async () => {
    let fail = true;
    const t = setup({ ping: async () => { if (fail) throw new Error("down"); } });
    await t.health.checkAll();
    expect(t.sessions[0].status).toBe("degraded");
    fail = false;
    await t.health.checkAll();
    expect(t.sessions[0].status).toBe("connected");
    // The failure streak starts over.
    fail = true;
    await t.health.checkAll();
    await t.health.checkAll();
    expect(t.reconnect).not.toHaveBeenCalled();
  });

  it("pings_on_online_event", async () => {
    const t = setup();
    t.health.start();
    t.win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ping).toHaveBeenCalledTimes(1);
    t.health.stop();
  });

  it("pings when the page becomes visible again, not when it is hidden", async () => {
    const t = setup();
    t.health.start();
    t.doc.visibilityState = "hidden";
    t.doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ping).not.toHaveBeenCalled();
    t.doc.visibilityState = "visible";
    t.doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ping).toHaveBeenCalledTimes(1);
    t.health.stop();
  });

  it("reconnects_after_three_failures", async () => {
    const t = setup({ ping: async () => { throw new Error("down"); } });
    await t.health.checkAll();
    await t.health.checkAll();
    expect(t.reconnect).not.toHaveBeenCalled();
    await t.health.checkAll();
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    expect(t.reconnect).toHaveBeenCalledWith("a");
    // The streak was consumed by the reconnect: the next failure starts a new count.
    await t.health.checkAll();
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  });

  it("stops_pinging_closed_session", async () => {
    const t = setup();
    t.health.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.ping).toHaveBeenCalledTimes(1);
    t.sessions = [];
    await vi.advanceTimersByTimeAsync(90_000);
    expect(t.ping).toHaveBeenCalledTimes(1);
    t.health.stop();
  });

  it("only pings connected or degraded sessions", async () => {
    const t = setup();
    t.sessions = [
      { id: "c", status: "connecting" },
      { id: "e", status: "error" },
      { id: "ok", status: "connected" },
      { id: "d", status: "degraded" },
    ];
    await t.health.checkAll();
    expect(t.ping.mock.calls.map((c) => c[0]).sort()).toEqual(["d", "ok"]);
  });

  it("does not stack pings while one is still in flight", async () => {
    let release: () => void = () => {};
    const t = setup({ ping: () => new Promise<void>((r) => { release = r; }) });
    const first = t.health.checkAll();
    await t.health.checkAll();
    expect(t.ping).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it("stop removes the timer and the listeners", async () => {
    const t = setup();
    t.health.start();
    t.health.stop();
    t.win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.ping).not.toHaveBeenCalled();
  });
});

describe("supervising a lost session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function lostSetup(backoff = [30_000, 60_000]) {
    let sessions: HealthSession[] = [{ id: "a", status: "connected" }];
    let networkUp = false;
    const set = (id: string, status: HealthSession["status"]) => { sessions = sessions.map((s) => (s.id === id ? { ...s, status } : s)); };
    const reconnect = vi.fn(async (id: string) => {
      set(id, "connecting");
      set(id, networkUp ? "connected" : "error");
    });
    const onDegraded = vi.fn();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const health = createSessionHealth({
      ping: async () => { if (!networkUp) throw new Error("down"); },
      sessions: () => sessions,
      setStatus: (id, st) => set(id, st),
      reconnect,
      onDegraded,
      retryBackoffMs: backoff,
      win,
      doc,
    });
    return {
      health, reconnect, onDegraded, win, doc,
      get sessions() { return sessions; },
      set sessions(v: HealthSession[]) { sessions = v; },
      up(v: boolean) { networkUp = v; },
    };
  }

  async function loseSession(t: ReturnType<typeof lostSetup>) {
    for (let i = 0; i < 3; i++) await t.health.checkAll();
    expect(t.sessions[0].status).toBe("error");
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  }

  it("retries a failed reconnect with backoff, repeating the last delay", async () => {
    const t = lostSetup();
    await loseSession(t);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.reconnect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(t.reconnect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.reconnect).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); // last delay repeats
    expect(t.reconnect).toHaveBeenCalledTimes(4);
  });

  it("wake_while_network_down_then_network_returns_recovers", async () => {
    const t = lostSetup();
    t.health.start();
    await loseSession(t);

    // The machine wakes but the network is still down: one immediate attempt, which fails.
    t.doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.reconnect).toHaveBeenCalledTimes(2);
    expect(t.sessions[0].status).toBe("error");

    // The network comes back: no waiting for the backoff timer.
    t.up(true);
    t.win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.reconnect).toHaveBeenCalledTimes(3);
    expect(t.sessions[0].status).toBe("connected");

    // Recovered: supervision is over, no further retries.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.reconnect).toHaveBeenCalledTimes(3);
    t.health.stop();
  });

  it("no_retries_after_manual_close", async () => {
    const t = lostSetup();
    t.health.start();
    await loseSession(t);
    t.sessions = []; // the user closed the session
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    t.win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    t.health.stop();
  });

  it("stops retrying when the user reconnects the session themselves", async () => {
    const t = lostSetup();
    await loseSession(t);
    t.up(true);
    t.sessions = [{ id: "a", status: "connected" }];
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  });

  it("reconnectNow ignores a click while a reconnect is running or connecting", async () => {
    const t = lostSetup();
    t.up(true);
    t.sessions = [{ id: "a", status: "degraded" }];
    const first = t.health.reconnectNow("a");
    await t.health.reconnectNow("a");
    await first;
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    t.sessions = [{ id: "a", status: "connecting" }];
    await t.health.reconnectNow("a");
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  });

  it("tells the toast when the SSH tunnel is the cause", async () => {
    const t = lostSetup();
    const h = createSessionHealth({
      ping: async () => { throw { kind: "SshTunnel", message: "bastion:22" }; },
      sessions: () => t.sessions,
      setStatus: () => {},
      reconnect: t.reconnect,
      onDegraded: t.onDegraded,
      win: null,
      doc: null,
    });
    await h.checkAll();
    expect(t.onDegraded).toHaveBeenCalledWith("a", { sshEndpoint: "bastion:22" });
  });
});
