import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/mongoServer", () => ({
  serverMetrics: vi.fn(),
  slowOps: vi.fn(),
  profilerStatus: vi.fn(),
  recentSlowQueries: vi.fn(),
  killOp: vi.fn(),
}));

import * as api from "../api/mongoServer";
import { createOverviewPoller } from "./overviewPoller.svelte";
import { prefs } from "./prefs.svelte";

const metrics = api.serverMetrics as ReturnType<typeof vi.fn>;
const slow = api.slowOps as ReturnType<typeof vi.fn>;
const prof = api.profilerStatus as ReturnType<typeof vi.fn>;
const recent = api.recentSlowQueries as ReturnType<typeof vi.fn>;

let query = 0;
let uptime = 100;
const text = () =>
  JSON.stringify({
    uptime, host: "h", version: "8.0.4",
    opcounters: { insert: 0, query, update: 0, delete: 0, getmore: 0, command: 0 },
    connections: { current: 10, available: 90 }, network: { bytesIn: 0, bytesOut: 0 }, mem: { resident: 512 },
  });
const flush = () => vi.advanceTimersByTimeAsync(0);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createOverviewPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    prefs.clear();
    query = 0;
    uptime = 100;
    metrics.mockImplementation(async () => { query += 200; uptime += 2; return text(); });
    slow.mockResolvedValue([]);
    prof.mockResolvedValue("[]");
    recent.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it("ticks once immediately on start, with the slow-op threshold", async () => {
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    expect(metrics).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledWith("s", 1);
    expect(p.latest?.connCurrent).toBe(10);
    p.stop();
  });

  it("never overlaps: the next tick waits for the previous one to settle", async () => {
    const d = deferred<string>();
    metrics.mockImplementationOnce(() => d.promise);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(metrics).toHaveBeenCalledTimes(1);
    d.resolve(text());
    await flush();
    // that tick took 10 s → the next one waits 1.5 × 10 s
    await vi.advanceTimersByTimeAsync(14_999);
    expect(metrics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(metrics).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("a slow tick stretches the interval to 1.5× its duration", async () => {
    metrics.mockImplementation(() => new Promise((r) => setTimeout(() => r(text()), 3000)));
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(metrics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4499);
    expect(metrics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(metrics).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("stop during in-flight tick schedules nothing and ignores the late result", async () => {
    const d = deferred<string>();
    metrics.mockImplementationOnce(() => d.promise);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    p.stop();
    d.resolve(text());
    await flush();
    expect(p.latest).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(metrics).toHaveBeenCalledTimes(1);
  });

  it("rates appear from the second sample; resuming after stop leaves a gap", async () => {
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    expect(p.series.ops).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.series.ops).toHaveLength(1);
    expect(p.series.ops[0]?.v).toBeGreaterThan(0);
    p.stop();
    p.start();
    await flush();
    expect(p.series.ops.at(-1)).toBeNull();
    expect(p.series.conns.at(-2)).toBeNull();
    p.stop();
  });

  it("a server restart (uptime drops) is a gap, never a spike", async () => {
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    metrics.mockImplementationOnce(async () => { uptime = 3; query = 5; return text(); });
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.series.ops).toEqual([null]);
    expect(p.rates).toBeNull();
    p.stop();
  });

  it("PROD defaults to 5 s; the chosen interval is remembered per connection", async () => {
    expect(createOverviewPoller("s", { prod: true, connId: 1 }).intervalMs).toBe(5000);
    const a = createOverviewPoller("s", { prod: false, connId: 7 });
    a.setIntervalMs(10_000);
    expect(createOverviewPoller("s", { prod: false, connId: 7 }).intervalMs).toBe(10_000);
    expect(createOverviewPoller("s", { prod: false, connId: 8 }).intervalMs).toBe(2000);
    prefs.setItem("lumio.overviewInterval.v1", "{bad");
    expect(createOverviewPoller("s", { prod: false, connId: 7 }).intervalMs).toBe(2000);
  });

  it("paused sends nothing; resuming ticks again", async () => {
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.setIntervalMs(null);
    p.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(metrics).not.toHaveBeenCalled();
    p.setIntervalMs(5000);
    await flush();
    expect(metrics).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("profiler: read at most every 30 s, only from databases where it is on", async () => {
    prof.mockResolvedValue(JSON.stringify([{ db: "shop", level: { $numberInt: "1" } }, { db: "x", level: { $numberInt: "0" } }]));
    recent.mockResolvedValue([JSON.stringify({ ts: { $date: { $numberLong: "1000" } }, op: "query" })]);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    expect(recent).toHaveBeenCalledWith("s", "shop", 20);
    expect(recent).toHaveBeenCalledTimes(1);
    expect(p.profiler?.enabled).toEqual(["shop"]);
    expect(p.profiler?.entries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(prof).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(22_000);
    expect(prof).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("a network error keeps the last values and marks them stale", async () => {
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    metrics.mockRejectedValueOnce({ kind: "Connection", message: "timed out" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(p.stale).toBe(true);
    expect(p.latest).not.toBeNull();
    expect(p.retryInSecs).toBeGreaterThan(0);
    p.stop();
  });

  it("no serverStatus permission → not permitted, slow ops still shown", async () => {
    metrics.mockRejectedValue({ kind: "Query", message: "not authorized on admin to execute command" });
    slow.mockResolvedValue([JSON.stringify({ opid: 5, op: "query", ns: "a.b", secs_running: 9, appName: "x" })]);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    expect(p.permitted).toBe(false);
    expect(p.stale).toBe(false);
    expect(p.slowOps.map((o) => o.opid)).toEqual([5]);
    p.stop();
  });

  it("kill asks through the destructive gate, then removes the op (mongos string opids too)", async () => {
    slow.mockResolvedValue([JSON.stringify({ opid: "shard01:5", op: "query", ns: "a.b", secs_running: 9 })]);
    (api.killOp as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    await flush();
    p.requestKill(p.slowOps[0]);
    await flush();
    expect(api.killOp).not.toHaveBeenCalled();
    expect(p.destructive.pending?.op).toBe("killOp");
    await p.destructive.confirm();
    expect(api.killOp).toHaveBeenCalledWith("s", "shard01:5");
    expect(p.slowOps).toEqual([]);
    p.stop();
  });

  it("restarting while a tick is out never sends a second pair at the same time", async () => {
    const d = deferred<string>();
    metrics.mockImplementationOnce(() => d.promise);
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    p.start();
    p.stop();
    p.start();
    p.setIntervalMs(5000);
    await flush();
    expect(metrics).toHaveBeenCalledTimes(1);
    d.resolve(text());
    await flush();
    expect(metrics).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("the sample is stamped when serverStatus answers, not when currentOp does", async () => {
    slow.mockImplementation(() => new Promise((r) => setTimeout(() => r([]), 1500)));
    metrics.mockImplementation(async () => { query += 200; uptime += 2; return text(); });
    const p = createOverviewPoller("s", { prod: false, connId: 1 });
    const t0 = Date.now();
    p.start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(p.latest?.at).toBe(t0);
    p.stop();
  });
});
