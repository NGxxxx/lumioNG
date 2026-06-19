import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import type { DbStatsInfo } from "../domain/stats";

let mockStats: DbStatsInfo | null = null;
vi.mock("../stores/databaseStats.svelte", () => ({
  createDatabaseStats: () => ({
    get stats() {
      return mockStats;
    },
    get error() {
      return null;
    },
    get loading() {
      return false;
    },
    init: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import DatabaseStatsPanel from "./DatabaseStatsPanel.svelte";

describe("DatabaseStatsPanel", () => {
  it("hiển thị số collection đã format", () => {
    mockStats = {
      db: "shop",
      collections: 5,
      objects: 12000,
      dataSize: 1048576,
      storageSize: 524288,
      indexes: 8,
      indexSize: 131072,
    };
    const { getByText } = render(DatabaseStatsPanel, { props: { db: "shop" } });
    expect(getByText("12,000")).toBeTruthy();
  });
});
