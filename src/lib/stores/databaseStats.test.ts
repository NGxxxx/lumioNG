import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/stats", () => ({
  collStats: vi.fn(),
  collOptions: vi.fn(),
  dbStats: vi.fn(),
}));

import * as api from "../api/stats";
import { createDatabaseStats } from "./databaseStats.svelte";

const dbStats = api.dbStats as ReturnType<typeof vi.fn>;

describe("createDatabaseStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbStats.mockResolvedValue("{}");
  });

  it("init gọi dbStats + parse", async () => {
    dbStats.mockResolvedValueOnce(
      JSON.stringify({ db: "shop", objects: { $numberLong: "12000" } }),
    );
    const v = createDatabaseStats("shop");
    await v.init();
    expect(dbStats).toHaveBeenCalledWith("shop");
    expect(v.stats?.db).toBe("shop");
    expect(v.stats?.objects).toBe(12000);
    expect(v.error).toBeNull();
  });

  it("lỗi api → set error, không ném", async () => {
    dbStats.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createDatabaseStats("shop");
    await v.refresh();
    expect(v.error).toContain("boom");
  });
});
