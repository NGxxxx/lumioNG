import { describe, it, expect, vi, beforeEach } from "vitest";
import { createQueryWatch, type QueryWatchDeps } from "./queryWatch.svelte";
import type { ProfileStart, WatchMessage } from "../api/watch";

vi.mock("./commandLog.svelte", () => ({ commandLog: { push: vi.fn() } }));
vi.mock("./desktop", () => ({ pickSavePath: vi.fn() }));
vi.mock("../api/files", () => ({ writeTextFile: vi.fn() }));

import { commandLog } from "./commandLog.svelte";

const int = (n: number) => ({ $numberInt: String(n) });
const find = (ms: number, examined = 10) => ({
  op: "query", ns: "app.orders", millis: int(ms), planSummary: examined > 1000 ? "COLLSCAN" : "IXSCAN { a: 1 }",
  command: { find: "orders", filter: { a: 1 } }, docsExamined: int(examined), nreturned: int(1),
});
const update = { op: "update", ns: "app.orders", millis: int(3), command: { q: {}, u: { $set: { a: 2 } } }, nModified: int(1) };

function harness(result: ProfileStart = { status: "started", previousLevel: 0 }) {
  let on: ((m: WatchMessage) => void) | null = null;
  const deps: QueryWatchDeps = {
    start: vi.fn(async (_s, _id, _t, cb) => { on = cb; return result; }),
    stop: vi.fn(async () => {}),
    now: () => 0,
  };
  const send = (events: Record<string, unknown>[]) => on!({ type: "events", events, sizes: events.map(() => 10) });
  return { deps, send };
}

beforeEach(() => vi.clearAllMocks());

describe("createQueryWatch", () => {
  it("does nothing until started, then turns the profiler on at the chosen level", async () => {
    const h = harness();
    const q = createQueryWatch("s1", { db: "app", coll: "orders" }, h.deps);
    expect(q.status).toBe("idle");
    expect(h.deps.start).not.toHaveBeenCalled();

    q.capture = "slow";
    q.slowms = 250;
    await q.start();
    expect(h.deps.start).toHaveBeenCalledWith("s1", expect.any(String), { db: "app", coll: "orders", level: 1, slowms: 250 }, expect.any(Function));
    expect(q.status).toBe("recording");
    expect(commandLog.push).toHaveBeenCalledWith('db.setProfilingLevel(1, { "slowms": 250 })', "s1", 0);

    q.pause();
    expect(q.status).toBe("paused");
    expect(h.deps.stop).toHaveBeenCalledTimes(1);
  });

  it("collects entries and filters them by kind, missing index and text", async () => {
    const h = harness();
    const q = createQueryWatch("s1", { db: "app", coll: null }, h.deps);
    await q.start();
    h.send([find(5), find(1500, 50_000), update]);
    expect(q.entries.map((e) => e.name)).toEqual(["find", "find", "update"]);
    expect(q.counts).toEqual({ read: 2, write: 1, other: 0 });
    q.needsIndex = true;
    expect(q.visible.map((e) => e.millis)).toEqual([1500]);
    q.needsIndex = false;
    q.soloKind("write");
    expect(q.visible.map((e) => e.name)).toEqual(["update"]);
    q.soloKind("write");
    q.text = "orders";
    expect(q.visible).toHaveLength(3);
  });

  it.each([
    [{ status: "mongos" } as ProfileStart, { reason: "mongos" }],
    [{ status: "readOnly" } as ProfileStart, { reason: "readOnly" }],
    [{ status: "denied", message: "Unauthorized (code 13): no" } as ProfileStart, { reason: "denied", message: "Unauthorized (code 13): no" }],
    [{ status: "unsupported", message: "AtlasError" } as ProfileStart, { reason: "unsupported", message: "AtlasError" }],
  ])("explains why the profiler can't be used (%o)", async (res, expected) => {
    const h = harness(res);
    const q = createQueryWatch("s1", { db: "app", coll: null }, h.deps);
    await q.start();
    expect(q.status).toBe("unavailable");
    expect(q.unavailable).toEqual(expected);
  });

  it("a whole-deployment watch has no database to profile", async () => {
    const h = harness();
    const q = createQueryWatch("s1", { db: null, coll: null }, h.deps);
    expect(q.status).toBe("unavailable");
    expect(q.unavailable).toEqual({ reason: "deployment" });
    await q.start();
    expect(h.deps.start).not.toHaveBeenCalled();
  });

  it("stops a profiler that finished starting after the tab was closed", async () => {
    let resolve: (r: ProfileStart) => void = () => {};
    const h = harness();
    h.deps.start = vi.fn(() => new Promise<ProfileStart>((r) => { resolve = r; }));
    const q = createQueryWatch("s1", { db: "app", coll: null }, h.deps);
    const started = q.start();
    q.dispose();
    resolve({ status: "started", previousLevel: 0 });
    await started;
    expect(h.deps.stop).toHaveBeenCalled();
  });

  it("reports a failure while following the profiler", async () => {
    const h = harness();
    const q = createQueryWatch("s1", { db: "app", coll: null }, h.deps);
    await q.start();
    const on = (h.deps.start as ReturnType<typeof vi.fn>).mock.calls[0][3] as (m: WatchMessage) => void;
    on({ type: "error", message: "not authorized on app to execute command { find: \"system.profile\" }" });
    expect(q.status).toBe("error");
    expect(q.error).toContain("system.profile");
  });
});
