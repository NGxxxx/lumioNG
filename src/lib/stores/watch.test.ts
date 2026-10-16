import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWatch, type WatchDeps } from "./watch.svelte";
import type { WatchMessage, WatchStart } from "../api/watch";

vi.mock("./commandLog.svelte", () => ({ commandLog: { push: vi.fn() } }));
vi.mock("./desktop", () => ({ pickSavePath: vi.fn() }));
vi.mock("../api/files", () => ({ writeTextFile: vi.fn() }));

import { commandLog } from "./commandLog.svelte";
import { pickSavePath } from "./desktop";
import { writeTextFile } from "../api/files";

const int = (n: number) => ({ $numberInt: String(n) });
const ns = { db: "app", coll: "orders" };
const ins = (id: number, doc: Record<string, unknown> = {}) => ({
  operationType: "insert", ns, documentKey: { _id: int(id) }, fullDocument: { _id: int(id), ...doc },
});
const upd = (id: number, fields: Record<string, unknown>) => ({
  operationType: "update", ns, documentKey: { _id: int(id) }, updateDescription: { updatedFields: fields, removedFields: [] },
});

function harness(result: WatchStart = { status: "started", preImages: false }) {
  const listeners = new Map<string, (m: WatchMessage) => void>();
  let resolveStart: ((r: WatchStart) => void) | null = null;
  const deps: WatchDeps = {
    start: vi.fn((_s, id, _t, on) => {
      listeners.set(id, on);
      return new Promise<WatchStart>((r) => { resolveStart = r; });
    }),
    stop: vi.fn(async () => {}),
    fetchDoc: vi.fn(async () => null),
    now: () => 1000,
  };
  const send = (id: string, events: Record<string, unknown>[]) =>
    listeners.get(id)!({ type: "events", events, sizes: events.map(() => 10) });
  const open = async () => {
    await vi.waitFor(() => expect(resolveStart).not.toBeNull());
    resolveStart!(result);
    resolveStart = null;
    await Promise.resolve();
  };
  return { deps, send, open, ids: () => [...listeners.keys()] };
}

beforeEach(() => vi.clearAllMocks());

describe("createWatch", () => {
  it("records events while open and logs the watch command", async () => {
    const h = harness();
    const w = createWatch("s1", { db: "app", coll: "orders" }, h.deps);
    void w.start();
    await h.open();
    expect(w.status).toBe("recording");
    expect(commandLog.push).toHaveBeenCalledWith(expect.stringContaining('db.getCollection("orders").watch('), "s1", 0);

    const id = h.ids()[0];
    h.send(id, [ins(1, { a: 1 }), upd(1, { a: 2 })]);
    expect(w.events.map((e) => e.op)).toEqual(["insert", "update"]);
    expect(w.counts.update).toBe(1);

    w.select(w.events[1].seq);
    expect(w.selected?.before).toEqual({ _id: int(1), a: 1 });
    expect(w.history.map((e) => e.op)).toEqual(["insert", "update"]);

    w.dispose();
    expect(h.deps.stop).toHaveBeenCalledWith("s1", id);
  });

  it("filters by operation and text without dropping events", async () => {
    const h = harness();
    const w = createWatch("s1", { db: "app", coll: null }, h.deps);
    void w.start();
    await h.open();
    h.send(h.ids()[0], [ins(1), upd(1, { status: "x" }), ins(2)]);
    w.soloOp("update");
    expect(w.visible.map((e) => e.op)).toEqual(["update"]);
    w.soloOp("update");
    expect(w.visible).toHaveLength(3);
    w.toggleOp("insert");
    w.text = "status";
    expect(w.visible.map((e) => e.seq)).toEqual([2]);
    expect(w.events).toHaveLength(3);
  });

  it("ignores late batches after pause and forgets states seen before it", async () => {
    const h = harness();
    const w = createWatch("s1", { db: "app", coll: "orders" }, h.deps);
    void w.start();
    await h.open();
    const first = h.ids()[0];
    h.send(first, [ins(1, { a: 1 })]);
    w.pause();
    expect(w.status).toBe("paused");
    expect(h.deps.stop).toHaveBeenCalledWith("s1", first);
    h.send(first, [ins(9)]);
    expect(w.events).toHaveLength(1);

    void w.start();
    await h.open();
    h.send(h.ids()[1], [upd(1, { a: 3 })]);
    expect(w.events[1].beforeSource).toBe("none");
  });

  it("stops a stream that finishes opening after the tab was paused", async () => {
    const h = harness();
    const w = createWatch("s1", { db: "app", coll: "orders" }, h.deps);
    void w.start();
    await vi.waitFor(() => expect(h.ids()).toHaveLength(1));
    w.pause();
    await h.open();
    expect(w.status).toBe("paused");
    expect(h.deps.stop).toHaveBeenCalledTimes(2);
  });

  it("reports a standalone server and stream errors", async () => {
    const h = harness({ status: "standalone" });
    const w = createWatch("s1", { db: null, coll: null }, h.deps);
    void w.start();
    await h.open();
    expect(w.status).toBe("standalone");

    const h2 = harness();
    const w2 = createWatch("s1", { db: "app", coll: "orders" }, h2.deps);
    void w2.start();
    await h2.open();
    // Error after the stream opened.
    const on =(h2.deps.start as ReturnType<typeof vi.fn>).mock.calls[0][3] as (m: WatchMessage) => void;
    on({ type: "error", message: "boom" });
    expect(w2.status).toBe("error");
    expect(w2.error).toBe("boom");
  });

  it("watching one document seeds its current state as the first 'before'", async () => {
    const h = harness();
    h.deps.fetchDoc = vi.fn(async () => ({ _id: int(7), n: 1 }));
    const w = createWatch("s1", { db: "app", coll: "orders", idText: '{"$numberInt":"7"}' }, h.deps);
    void w.start();
    await h.open();
    expect((h.deps.start as ReturnType<typeof vi.fn>).mock.calls[0][2].pipeline).toContain('"documentKey._id"');
    h.send(h.ids()[0], [upd(7, { n: 2 })]);
    expect(w.events[0].beforeSource).toBe("session");
    expect(w.events[0].before).toEqual({ _id: int(7), n: 1 });
  });

  it("exports the recording to the chosen file", async () => {
    const h = harness();
    const w = createWatch("s1", { db: "app", coll: "orders" }, h.deps);
    void w.start();
    await h.open();
    h.send(h.ids()[0], [ins(1)]);
    vi.mocked(pickSavePath).mockResolvedValueOnce("/tmp/x.json");
    expect(await w.exportToFile()).toBe("/tmp/x.json");
    expect(JSON.parse(vi.mocked(writeTextFile).mock.calls[0][1])).toEqual([ins(1)]);
  });
});
