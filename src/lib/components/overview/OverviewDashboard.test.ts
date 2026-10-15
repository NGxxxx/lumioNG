import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/svelte";

let readOnly = false;
vi.mock("../../stores/sessionManager.svelte", () => ({
  sessionManager: {
    get active() {
      return { id: "conn:1", readOnly, host: { info: null } };
    },
  },
}));

const poller = {
  intervalMs: 2000 as number | null,
  threshold: 1,
  latest: null as unknown,
  rates: null as unknown,
  series: { ops: [], conns: [], net: [], mem: [] },
  slowOps: [] as unknown[],
  profiler: null as unknown,
  permitted: true,
  stale: false,
  retryInSecs: 2,
  running: false,
  destructive: undefined as unknown,
  start: vi.fn(),
  stop: vi.fn(),
  setIntervalMs: vi.fn(),
  setThreshold: vi.fn(),
  requestKill: vi.fn(),
};
vi.mock("../../stores/overviewPoller.svelte", () => ({
  OVERVIEW_INTERVALS: [2000, 5000, 10000],
  SLOW_THRESHOLDS: [1, 5, 30],
  createOverviewPoller: () => poller,
}));

import OverviewDashboard from "./OverviewDashboard.svelte";
import { createDestructiveGate } from "../../stores/destructiveGate.svelte";

const sample = {
  at: 0, uptime: 3600, host: "db-1", version: "8.0.4", connCurrent: 85, connAvailable: 15, netIn: 0, netOut: 0, memResidentMb: 512,
  opcounters: { insert: 0, query: 0, update: 0, delete: 0, getmore: 0, command: 0 },
};
const rates = { ops: 1240, byKind: { insert: 40, query: 1200, update: 0, delete: 0, getmore: 0, command: 0 }, netInPerSec: 1024, netOutPerSec: 2048 };
const conn = { label: "staging", uri: "mongodb://h:27017" };

describe("OverviewDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poller.destructive = createDestructiveGate(() => "");
    readOnly = false;
    Object.assign(poller, { latest: null, rates: null, slowOps: [], profiler: null, permitted: true, stale: false, intervalMs: 2000 });
  });

  it("starts polling on mount and stops when the window is hidden", async () => {
    render(OverviewDashboard, { props: { connection: conn } });
    expect(poller.start).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(poller.stop).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("shows the health sentence and the four tiles", () => {
    Object.assign(poller, { latest: { ...sample, connCurrent: 38, connAvailable: 962 }, rates });
    const { getByText, getByLabelText } = render(OverviewDashboard, { props: { connection: conn } });
    expect(getByText(/Stable · 1,240 ops\/s · 38 connections/)).toBeTruthy();
    for (const l of ["Ops/s", "Connections", "Network", "Memory"]) expect(getByLabelText(l)).toBeTruthy();
    expect(getByText("of 1,000 · 4%")).toBeTruthy();
  });

  it("warns about connections near the limit and about slow ops (plural aware)", () => {
    Object.assign(poller, { latest: sample, rates });
    const a = render(OverviewDashboard, { props: { connection: conn } });
    expect(a.getByText(/Connections at 85% of the limit/)).toBeTruthy();
    a.unmount();
    Object.assign(poller, { slowOps: [{ opid: 1, op: "query", ns: "a.b", secs: 9, client: "", appName: "x" }] });
    const b = render(OverviewDashboard, { props: { connection: conn } });
    expect(b.getByText(/1 operation running ≥ 1s/)).toBeTruthy();
  });

  it("interval buttons call setIntervalMs (Pause = null)", async () => {
    const { getByRole } = render(OverviewDashboard, { props: { connection: conn } });
    const group = within(getByRole("radiogroup", { name: "Refresh every" }));
    await fireEvent.click(group.getByRole("radio", { name: "5s" }));
    expect(poller.setIntervalMs).toHaveBeenCalledWith(5000);
    await fireEvent.click(group.getByRole("radio", { name: "Pause" }));
    expect(poller.setIntervalMs).toHaveBeenCalledWith(null);
  });

  it("not permitted → tiles say so", () => {
    Object.assign(poller, { permitted: false });
    const { getAllByText } = render(OverviewDashboard, { props: { connection: conn } });
    expect(getAllByText("Not permitted")).toHaveLength(4);
  });

  it("profiler off → explanation + copyable snippet; on → list", () => {
    Object.assign(poller, { profiler: { enabled: [], entries: [] } });
    const a = render(OverviewDashboard, { props: { connection: conn } });
    expect(a.getByText(/Profiler is off/)).toBeTruthy();
    expect(a.getByText("db.setProfilingLevel(1, { slowms: 100 })")).toBeTruthy();
    a.unmount();
    Object.assign(poller, { profiler: { enabled: ["shop"], entries: [JSON.stringify({ op: "query", ns: "shop.orders", millis: 812, ts: { $date: "2026-01-01T00:00:00Z" } })] } });
    const b = render(OverviewDashboard, { props: { connection: conn } });
    expect(b.getByText("812 ms")).toBeTruthy();
    expect(b.getByText("shop.orders")).toBeTruthy();
  });

  it("no profiler section when it can't be read", () => {
    const { queryByLabelText } = render(OverviewDashboard, { props: { connection: conn } });
    expect(queryByLabelText("Recent slow queries (profiler)")).toBeNull();
  });

  it("Kill goes through the destructive gate; hidden on read-only sessions", async () => {
    const op = { opid: "shard01:7", op: "query", ns: "a.b", secs: 9, client: "", appName: "x" };
    Object.assign(poller, { slowOps: [op] });
    const a = render(OverviewDashboard, { props: { connection: conn } });
    await fireEvent.click(a.getByRole("button", { name: "Kill" }));
    expect(poller.requestKill).toHaveBeenCalledWith(op);
    a.unmount();
    readOnly = true;
    const b = render(OverviewDashboard, { props: { connection: conn } });
    expect(b.queryByRole("button", { name: "Kill" })).toBeNull();
  });
});
