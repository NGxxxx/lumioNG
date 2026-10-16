// src/lib/stores/overviewPoller.svelte.ts — live samples for the Host Overview dashboard.
// Polls only between start() and stop() (the component ties those to "Overview shown and window
// visible"), never has two ticks in flight, and stretches the interval when the server is slow.
import { serverMetrics, slowOps as fetchSlowOps, profilerStatus, recentSlowQueries, killOp } from "../api/mongoServer";
import { rawErrorText } from "../api/errors";
import { createDestructiveGate } from "./destructiveGate.svelte";
import { sessionEnvironment } from "./sessionEnv";
import { numFromExt } from "../domain/extjson";
import { OWN_APP_NAME } from "../domain/host";
import {
  parseSample, parseProfileEntry, rates as rateOf, pushPoint, nextDelay, parseSlowOps,
  type Sample, type Rates, type Point, type SlowOp,
} from "../domain/serverMetrics";

export const OVERVIEW_INTERVALS = [2000, 5000, 10000] as const;
export const SLOW_THRESHOLDS = [1, 5, 30] as const;
export type SlowThreshold = (typeof SLOW_THRESHOLDS)[number];
const PROFILER_EVERY_MS = 30_000;
const PROFILER_PER_DB = 20;
const PROFILER_SHOWN = 50;
const STORAGE_KEY = "lumio.overviewInterval.v1";

export type OverviewSeries = { ops: Point[]; conns: Point[]; net: Point[]; mem: Point[] };
export type ProfilerView = { enabled: string[]; entries: string[] };

function loadIntervals(): Record<string, number | null> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number | null>) : {};
  } catch {
    return {};
  }
}

function rememberedInterval(connId: number | null): number | null | undefined {
  if (connId === null) return undefined;
  const v = loadIntervals()[String(connId)];
  if (v === null) return null;
  return typeof v === "number" && (OVERVIEW_INTERVALS as readonly number[]).includes(v) ? v : undefined;
}

function saveInterval(connId: number | null, ms: number | null) {
  if (connId === null) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadIntervals(), [String(connId)]: ms }));
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

const isPermissionError = (e: unknown) => /unauthori[sz]ed|not authorized|requires authentication/i.test(rawErrorText(e));

export function createOverviewPoller(sessionId: string, opts: { prod: boolean; connId: number | null }) {
  const remembered = rememberedInterval(opts.connId);
  let intervalMs = $state<number | null>(remembered !== undefined ? remembered : opts.prod ? 5000 : 2000);
  let threshold = $state<SlowThreshold>(1);
  let latest = $state.raw<Sample | null>(null);
  let lastRates = $state.raw<Rates | null>(null);
  let series = $state.raw<OverviewSeries>({ ops: [], conns: [], net: [], mem: [] });
  let slow = $state.raw<SlowOp[]>([]);
  let profiler = $state.raw<ProfilerView | null>(null);
  let permitted = $state(true);
  let stale = $state(false);
  let retryInSecs = $state(0);
  let running = $state(false);

  // Plain (non-reactive) bookkeeping.
  let gen = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let prev: Sample | null = null;
  let gapPending = false;
  let profilerAt = -Infinity;
  let profilerBusy = false;

  function record(sample: Sample) {
    // A pause/hidden period or a server restart shows as a break in every sparkline, never as a
    // rate averaged across the gap or a negative spike.
    const resumed = gapPending && prev !== null;
    gapPending = false;
    const r = prev && !resumed ? rateOf(prev, sample) : null;
    const broken = resumed || (prev !== null && r === null);
    const at = sample.at;
    const next = { ...series };
    if (broken) for (const k of ["ops", "conns", "net", "mem"] as const) next[k] = pushPoint(next[k], null);
    if (r) {
      next.ops = pushPoint(next.ops, { at, v: r.ops });
      next.net = pushPoint(next.net, { at, v: r.netInPerSec + r.netOutPerSec });
    }
    next.conns = pushPoint(next.conns, { at, v: sample.connCurrent });
    if (sample.memResidentMb !== null) next.mem = pushPoint(next.mem, { at, v: sample.memResidentMb });
    series = next;
    prev = sample;
    latest = sample;
    lastRates = r;
  }

  async function loadProfiler(g: number) {
    if (profilerBusy) return;
    profilerBusy = true;
    profilerAt = Date.now();
    try {
      const rows = JSON.parse(await profilerStatus(sessionId)) as { db?: unknown; level?: unknown }[];
      const enabled = (Array.isArray(rows) ? rows : [])
        .filter((r) => typeof r.db === "string" && (numFromExt(r.level) ?? 0) >= 1)
        .map((r) => r.db as string);
      const lists = await Promise.allSettled(enabled.map((db) => recentSlowQueries(sessionId, db, PROFILER_PER_DB)));
      if (g !== gen) return;
      const entries = lists
        .flatMap((l) => (l.status === "fulfilled" ? l.value : []))
        .map((t) => ({ t, ts: parseProfileEntry(t)?.ts ?? 0 }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, PROFILER_SHOWN)
        .map((e) => e.t);
      profiler = { enabled, entries };
    } catch {
      if (g === gen) profiler = null; // unreadable: the section simply isn't shown
    } finally {
      profilerBusy = false;
    }
  }

  // The tick whose requests are still out: a restart waits for it instead of sending a second pair.
  let inFlight: Promise<void> | null = null;

  function tick(g: number): Promise<void> {
    const p = runTick(g).finally(() => {
      if (inFlight === p) inFlight = null;
    });
    inFlight = p;
    return p;
  }

  async function runTick(g: number) {
    const t0 = Date.now();
    // Stamp the sample when serverStatus answers — not when the (possibly slower) currentOp does —
    // so the rate's time base matches the counters.
    const metrics = serverMetrics(sessionId).then((text) => ({ text, at: Date.now() }));
    const [m, s] = await Promise.allSettled([metrics, fetchSlowOps(sessionId, threshold)]);
    if (g !== gen) return; // stopped, paused or restarted meanwhile: drop the late result
    if (m.status === "fulfilled") {
      const sample = parseSample(m.value.text, m.value.at);
      if (sample) record(sample);
      permitted = true;
      stale = false;
    } else if (isPermissionError(m.reason)) {
      permitted = false;
      stale = false;
    } else {
      stale = true;
    }
    if (s.status === "fulfilled") slow = parseSlowOps(s.value, OWN_APP_NAME);
    if (Date.now() - profilerAt >= PROFILER_EVERY_MS) void loadProfiler(g);
    schedule(g, nextDelay(intervalMs ?? 0, Date.now() - t0));
  }

  function schedule(g: number, delay: number) {
    if (!running || intervalMs === null || g !== gen) return;
    retryInSecs = Math.max(1, Math.round(delay / 1000));
    timer = setTimeout(() => {
      timer = undefined;
      if (g === gen) void tick(g);
    }, delay);
  }

  function restart() {
    const g = ++gen;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!running || intervalMs === null) return;
    // Never two ticks at once: if one is still out, start right after it settles (its result is dropped).
    if (inFlight) void inFlight.then(() => { if (g === gen && running && intervalMs !== null) void tick(g); });
    else void tick(g);
  }

  function start() {
    if (running) return;
    running = true;
    if (prev) gapPending = true;
    restart();
  }

  function stop() {
    running = false;
    restart(); // bumps the generation: an in-flight tick is ignored and schedules nothing
  }

  function setIntervalMs(ms: number | null) {
    if (ms === intervalMs) return;
    if (intervalMs === null && prev) gapPending = true; // resuming from Paused
    intervalMs = ms;
    saveInterval(opts.connId, ms);
    restart();
  }

  function setThreshold(t: SlowThreshold) {
    threshold = t;
    slow = slow.filter((o) => o.secs >= t);
  }

  // Kill goes through the destructive gate: a confirm, typed opid on PROD.
  const destructive = createDestructiveGate(() => sessionEnvironment(sessionId));

  function requestKill(op: SlowOp) {
    void destructive.request(
      { op: "killOp", target: { db: "admin", opid: String(op.opid), detail: [op.op, op.ns, op.appName || op.client].filter(Boolean).join(" · ") } },
      async () => {
        await killOp(sessionId, op.opid);
        slow = slow.filter((o) => o.opid !== op.opid);
      },
    );
  }

  return {
    get intervalMs() { return intervalMs; },
    get threshold() { return threshold; },
    get latest() { return latest; },
    get rates() { return lastRates; },
    get series() { return series; },
    get slowOps() { return slow; },
    get profiler() { return profiler; },
    get permitted() { return permitted; },
    get stale() { return stale; },
    get retryInSecs() { return retryInSecs; },
    get running() { return running; },
    /** The kill waiting for confirmation (rendered by DestructiveDialog). */
    get destructive() { return destructive; },
    start,
    stop,
    setIntervalMs,
    setThreshold,
    requestKill,
  };
}

export type OverviewPoller = ReturnType<typeof createOverviewPoller>;
