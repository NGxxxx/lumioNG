import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/stats", () => ({
  collStats: vi.fn(),
  collOptions: vi.fn(),
  dbStats: vi.fn(),
}));
vi.mock("../api/admin", () => ({
  setCollectionValidator: vi.fn(),
}));

import * as api from "../api/stats";
import * as adminApi from "../api/admin";
import { createCollectionInfo } from "./collectionInfo.svelte";
import { commandLog } from "./commandLog.svelte";

const collStats = api.collStats as ReturnType<typeof vi.fn>;
const collOptions = api.collOptions as ReturnType<typeof vi.fn>;
const setCollectionValidator = adminApi.setCollectionValidator as ReturnType<typeof vi.fn>;

const statsJson = JSON.stringify({ ns: "d.c", count: { $numberInt: "3" }, capped: false });
const optsJson = JSON.stringify({ name: "c", options: { validationLevel: "strict" } });

describe("createCollectionInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    collStats.mockResolvedValue("{}");
    collOptions.mockResolvedValue("{}");
    commandLog.clear();
  });

  it("init calls both api endpoints and parses results", async () => {
    collStats.mockResolvedValueOnce(statsJson);
    collOptions.mockResolvedValueOnce(optsJson);
    const v = createCollectionInfo("conn:1", "d", "c");
    await v.init();
    expect(collStats).toHaveBeenCalledWith("conn:1", "d", "c");
    expect(collOptions).toHaveBeenCalledWith("conn:1", "d", "c");
    expect(v.stats?.count).toBe(3);
    expect(v.options?.validationLevel).toBe("strict");
    expect(v.error).toBeNull();
  });

  it("api error sets error and does not throw", async () => {
    collStats.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionInfo("conn:1", "d", "c");
    await v.refresh();
    expect(v.error).toContain("boom");
  });

  it("init pushes collStatsCmd with a measured duration", async () => {
    collStats.mockResolvedValueOnce(statsJson);
    collOptions.mockResolvedValueOnce(optsJson);
    const v = createCollectionInfo("conn:1", "d", "c");
    await v.init();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("saveValidator calls the API, reloads options, and reports success", async () => {
    setCollectionValidator.mockResolvedValueOnce(undefined);
    collStats.mockResolvedValue(statsJson);
    collOptions.mockResolvedValue(optsJson);
    const v = createCollectionInfo("conn:1", "d", "c");
    const ok = await v.saveValidator('{"a":1}', "strict", "error");
    expect(ok).toBe(true);
    expect(setCollectionValidator).toHaveBeenCalledWith("conn:1", "d", "c", '{"a":1}', "strict", "error");
    expect(v.options?.validationLevel).toBe("strict"); // reloaded
    expect(v.validatorError).toBeNull();
  });

  it("saveValidator surfaces an API error without throwing", async () => {
    setCollectionValidator.mockRejectedValueOnce({ kind: "Query", message: "bad schema" });
    const v = createCollectionInfo("conn:1", "d", "c");
    const ok = await v.saveValidator("{bad json", "strict", "error");
    expect(ok).toBe(false);
    expect(v.validatorError).toContain("bad schema");
  });
});
