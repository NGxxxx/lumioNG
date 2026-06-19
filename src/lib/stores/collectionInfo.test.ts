import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/stats", () => ({
  collStats: vi.fn(),
  collOptions: vi.fn(),
  dbStats: vi.fn(),
}));

import * as api from "../api/stats";
import { createCollectionInfo } from "./collectionInfo.svelte";

const collStats = api.collStats as ReturnType<typeof vi.fn>;
const collOptions = api.collOptions as ReturnType<typeof vi.fn>;

const statsJson = JSON.stringify({ ns: "d.c", count: { $numberInt: "3" }, capped: false });
const optsJson = JSON.stringify({ name: "c", options: { validationLevel: "strict" } });

describe("createCollectionInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collStats.mockResolvedValue("{}");
    collOptions.mockResolvedValue("{}");
  });

  it("init gọi cả hai api + parse", async () => {
    collStats.mockResolvedValueOnce(statsJson);
    collOptions.mockResolvedValueOnce(optsJson);
    const v = createCollectionInfo("d", "c");
    await v.init();
    expect(collStats).toHaveBeenCalledWith("d", "c");
    expect(collOptions).toHaveBeenCalledWith("d", "c");
    expect(v.stats?.count).toBe(3);
    expect(v.options?.validationLevel).toBe("strict");
    expect(v.error).toBeNull();
  });

  it("lỗi api → set error, không ném", async () => {
    collStats.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionInfo("d", "c");
    await v.refresh();
    expect(v.error).toContain("boom");
  });
});
