import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";
import type { WatchMessage } from "../api/watch";

// The row virtualizer needs a nonzero scroller height to produce rows in jsdom.
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

let onMessage: ((m: WatchMessage) => void) | null = null;
const startWatch = vi.fn();
const startProfileWatch = vi.fn();
let onProfile: ((m: WatchMessage) => void) | null = null;
vi.mock("../api/watch", () => ({
  startWatch: (...args: unknown[]) => startWatch(...args),
  stopWatch: vi.fn().mockResolvedValue(undefined),
  startProfileWatch: (...args: unknown[]) => startProfileWatch(...args),
}));
vi.mock("../api/documents", () => ({ fetchFullDoc: vi.fn().mockResolvedValue(null) }));

import WatchTab from "./WatchTab.svelte";
import { disposeWatch } from "../stores/watchTabs.svelte";
import type { WatchTab as WatchTabT } from "../stores/navigation.svelte";

const int = (n: number) => ({ $numberInt: String(n) });
const ns = { db: "app", coll: "orders" };
let nextId = 1000;
const tabOf = (over: Partial<WatchTabT> = {}): WatchTabT => ({
  id: nextId++, kind: "watch", sessionId: "s1", db: "app", coll: "orders", idText: null, ...over,
});

beforeEach(() => {
  onMessage = null;
  onProfile = null;
  startProfileWatch.mockReset().mockImplementation(async (_s, _id, _t, on) => {
    onProfile = on;
    return { status: "started", previousLevel: 0 };
  });
  startWatch.mockReset().mockImplementation(async (_s, _id, _t, on) => {
    onMessage = on;
    return { status: "started", preImages: false };
  });
});

async function send(events: Record<string, unknown>[]) {
  onMessage!({ type: "events", events, sizes: events.map(() => 10) });
  await tick();
}

describe("WatchTab", () => {
  it("lists events live and shows the selected update's before/after", async () => {
    const tab = tabOf();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await vi.waitFor(() => expect(r.getByText("Recording")).toBeTruthy());
    expect(r.getByText(/Waiting for changes in app\.orders/)).toBeTruthy();

    await send([
      { operationType: "insert", ns, documentKey: { _id: int(1) }, fullDocument: { _id: int(1), status: "new" } },
      { operationType: "update", ns, documentKey: { _id: int(1) }, updateDescription: { updatedFields: { status: "paid" }, removedFields: [] } },
    ]);
    const options = r.getAllByRole("option");
    expect(options).toHaveLength(2);

    await fireEvent.click(options[1]);
    expect(r.getByText('"new"')).toBeTruthy();
    expect(r.getByText('"paid"')).toBeTruthy();
    expect(r.getByRole("tab", { name: "History (2)" })).toBeTruthy();

    await fireEvent.click(r.getByRole("tab", { name: "History (2)" }));
    expect(r.container.querySelectorAll(".timeline li")).toHaveLength(2);
    disposeWatch(tab.id);
  });

  it("operation chips filter the list", async () => {
    const tab = tabOf({ coll: null });
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await vi.waitFor(() => expect(onMessage).not.toBeNull());
    await send([
      { operationType: "insert", ns, documentKey: { _id: int(1) }, fullDocument: { _id: int(1) } },
      { operationType: "delete", ns, documentKey: { _id: int(1) } },
    ]);
    await fireEvent.click(r.getByRole("button", { name: /^Insert/ }));
    expect(r.getAllByRole("option")).toHaveLength(1);
    // Database-wide watch shows which collection each event belongs to.
    expect(r.getByText("Collection")).toBeTruthy();
    disposeWatch(tab.id);
  });

  it("explains how to get change streams on a standalone server", async () => {
    startWatch.mockResolvedValueOnce({ status: "standalone" });
    const tab = tabOf();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await vi.waitFor(() => expect(r.getByText("Change streams need a replica set")).toBeTruthy());
    disposeWatch(tab.id);
  });

  it("pause stops recording and Record resumes it", async () => {
    const tab = tabOf();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await vi.waitFor(() => expect(r.getByText("Recording")).toBeTruthy());
    await fireEvent.click(r.getByRole("button", { name: "Pause" }));
    expect(r.getAllByText("Paused").length).toBeGreaterThan(0);
    await fireEvent.click(r.getByRole("button", { name: "Record" }));
    await vi.waitFor(() => expect(startWatch).toHaveBeenCalledTimes(2));
    disposeWatch(tab.id);
  });

  it("explains a missing change-stream permission instead of showing the raw error", async () => {
    startWatch.mockRejectedValueOnce({ kind: "Query", message: "Unauthorized (code 13): not authorized on app to execute command" });
    const tab = tabOf();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await vi.waitFor(() => expect(r.getByText("No permission to watch changes")).toBeTruthy());
    disposeWatch(tab.id);
  });
});

describe("WatchTab — Queries mode", () => {
  const find = (ms: number, examined: number) => ({
    op: "query", ns: "app.orders", millis: { $numberInt: String(ms) }, planSummary: examined > 1000 ? "COLLSCAN" : "IXSCAN { a: 1 }",
    command: { find: "orders", filter: { a: 1 } }, docsExamined: { $numberInt: String(examined) }, nreturned: { $numberInt: "1" },
  });

  it("only turns the profiler on when asked, then lists queries with timing and index hints", async () => {
    const tab = tabOf();
    const onopenquery = vi.fn();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery } });
    await fireEvent.click(r.getByRole("tab", { name: "Queries" }));
    expect(r.getByText("Watch queries on app")).toBeTruthy();
    expect(startProfileWatch).not.toHaveBeenCalled();

    await fireEvent.click(r.getByRole("radio", { name: /Only queries slower than/ }));
    await fireEvent.click(r.getByRole("button", { name: "Turn on profiler and start" }));
    await vi.waitFor(() => expect(onProfile).not.toBeNull());
    expect(startProfileWatch.mock.calls[0][2]).toEqual({ db: "app", coll: "orders", level: 1, slowms: 100 });

    onProfile!({ type: "events", events: [find(4, 10), find(1800, 90_000)], sizes: [10, 10] });
    await tick();
    const rows = r.getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(r.getByText("1.8 s")).toBeTruthy();

    await fireEvent.click(rows[1]);
    expect(r.getByText(/Scanned the whole collection \(90,000 documents\)/)).toBeTruthy();
    await fireEvent.click(r.getByRole("button", { name: "Open in Query tab" }));
    expect(onopenquery).toHaveBeenCalledWith('db.getCollection("orders").find({"a":1})');

    await fireEvent.click(r.getByRole("button", { name: /Missing index/ }));
    expect(r.getAllByRole("option")).toHaveLength(1);
    disposeWatch(tab.id);
  });

  it.each([
    [{ status: "denied", message: "Unauthorized (code 13)" }, "No permission to turn the profiler on"],
    [{ status: "mongos" }, "Not available through mongos"],
    [{ status: "readOnly" }, "This connection is read-only"],
    [{ status: "unsupported", message: "AtlasError (code 8000)" }, "This server doesn't offer the profiler"],
  ])("says why the profiler can't be used (%o)", async (res, title) => {
    startProfileWatch.mockResolvedValueOnce(res);
    const tab = tabOf();
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await fireEvent.click(r.getByRole("tab", { name: "Queries" }));
    await fireEvent.click(r.getByRole("button", { name: "Turn on profiler and start" }));
    await vi.waitFor(() => expect(r.getByText(title)).toBeTruthy());
    disposeWatch(tab.id);
  });

  it("a whole-deployment watch asks to pick a database", async () => {
    const tab = tabOf({ db: null, coll: null });
    const r = render(WatchTab, { props: { tab, onopendocument: vi.fn(), onopenquery: vi.fn() } });
    await fireEvent.click(r.getByRole("tab", { name: "Queries" }));
    expect(r.getByText("Pick a database to watch queries")).toBeTruthy();
    disposeWatch(tab.id);
  });
});
