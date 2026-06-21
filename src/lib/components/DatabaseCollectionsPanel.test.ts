import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import type { CollRow } from "../stores/databaseCollections.svelte";

let mockRows: CollRow[] = [];
const setSort = vi.fn();
const loadStats = vi.fn();
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
  }),
}));

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
});
