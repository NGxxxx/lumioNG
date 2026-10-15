import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { CollRow } from "../stores/databaseCollections.svelte";

let mockRows: CollRow[] = [];
const setSort = vi.fn();
const loadStats = vi.fn();
const requestBulk = vi.hoisted(() => vi.fn());
vi.mock("../stores/databaseCollections.svelte", () => ({
  createDatabaseCollections: () => ({
    get rows() { return mockRows; },
    get summary() { return { db: "shop", collections: 1, objects: 5, dataSize: 100, storageSize: 200, indexes: 1, indexSize: 50 }; },
    get error() { return null; },
    get loading() { return false; },
    get sortCol() { return "name"; },
    get sortDir() { return "asc"; },
    init: vi.fn(),
    loadStats,
    loadAll: vi.fn(),
    setSort,
    requestBulk,
    destructive: { pending: null, running: false, error: null, seq: 0, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn() },
  }),
}));

const check = vi.hoisted(() => ({
  running: false, done: 2, total: 2, failed: [] as string[], minDays: null as number | null,
  rows: [] as unknown[],
  start: vi.fn(), cancel: vi.fn(),
}));
const createCheck = vi.hoisted(() => vi.fn(() => check));
vi.mock("../stores/dbIndexCheck.svelte", () => ({ createDbIndexCheck: createCheck }));

import DatabaseCollectionsPanel from "./DatabaseCollectionsPanel.svelte";

describe("DatabaseCollectionsPanel", () => {
  it("renders a row per collection and calls onopen on double-click", async () => {
    mockRows = [{ name: "users", state: "loaded", stats: { ns: "shop.users", count: 5, size: 1, avgObjSize: 1, storageSize: 1, totalIndexSize: 1, nindexes: 1, indexSizes: [], capped: false }, error: null }];
    const onopen = vi.fn();
    const { getByText } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen } });
    const cell = getByText("users");
    await fireEvent.dblClick(cell.closest("tr")!);
    expect(onopen).toHaveBeenCalledWith("users");
  });

  it("clicking a column header sorts", async () => {
    mockRows = [];
    const { getByText } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen: vi.fn() } });
    await fireEvent.click(getByText("Documents"));
    expect(setSort).toHaveBeenCalledWith("count");
  });

  it("bulk drop asks the store with the selected collections", async () => {
    mockRows = [{ name: "users", state: "idle", stats: null, error: null }];
    const { getAllByRole, getByRole } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen: vi.fn() } });
    await fireEvent.click(getAllByRole("checkbox")[1]);
    await fireEvent.click(getByRole("button", { name: /drop/i }));
    expect(requestBulk).toHaveBeenCalledWith("drop", ["users"], expect.any(Function));
  });

  it("index check runs only on click, lists results and opens the collection's indexes", async () => {
    mockRows = [{ name: "orders", state: "idle", stats: null, error: null }];
    check.rows = [{
      coll: "orders", status: "unused", size: 356_000_000, redundantWith: null, usage: { name: "legacyRef_1", ops: 0, since: 0 },
      info: { name: "legacyRef_1", entries: [{ field: "legacyRef", value: 1 }], unique: false, sparse: false, ttl: null, isId: false, hidden: false, partial: false, collation: null },
    }];
    const onopenindexes = vi.fn();
    const { getByRole, getByText, unmount } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen: vi.fn(), onopenindexes } });
    expect(createCheck).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Check indexes in this database" }));
    expect(check.start).toHaveBeenCalledTimes(1);
    expect(getByText("legacyRef_1")).toBeTruthy();
    expect(getByText("Unused")).toBeTruthy();
    await fireEvent.click(getByText("legacyRef_1").closest("tr")!);
    expect(onopenindexes).toHaveBeenCalledWith("orders");
    unmount();
    expect(check.cancel).toHaveBeenCalled();
  });

  it("while running shows progress and Cancel", async () => {
    mockRows = [];
    check.running = true;
    check.rows = [];
    const { getByRole, getByText } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen: vi.fn() } });
    await fireEvent.click(getByRole("button", { name: "Check indexes in this database" }));
    expect(getByText("2 / 2 collections")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Cancel" }));
    expect(check.cancel).toHaveBeenCalled();
    check.running = false;
  });

  it("index check warns when there are fewer than 7 days of usage data", async () => {
    mockRows = [];
    check.minDays = 2;
    const { getByRole, getByText } = render(DatabaseCollectionsPanel, { props: { db: "shop", onopen: vi.fn() } });
    await fireEvent.click(getByRole("button", { name: "Check indexes in this database" }));
    expect(getByText(/Only 2 days of usage data/)).toBeTruthy();
    check.minDays = null;
  });
});
