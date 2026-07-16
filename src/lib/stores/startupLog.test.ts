import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/server", () => ({ startupLog: vi.fn() }));

import * as api from "../api/server";
import { createStartupLog } from "./startupLog.svelte";

const startupLog = api.startupLog as ReturnType<typeof vi.fn>;

describe("createStartupLog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("load populates curated entries", async () => {
    startupLog.mockResolvedValue([JSON.stringify({ hostname: "box1", pid: { $numberInt: "1" } })]);
    const v = createStartupLog("conn:1");
    await v.load();
    expect(startupLog).toHaveBeenCalledWith("conn:1");
    expect(v.entries).toHaveLength(1);
    expect(v.entries[0].hostname).toBe("box1");
    expect(v.error).toBeNull();
  });

  it("soft-fails to an empty list when the connection lacks privilege to read local.startup_log", async () => {
    startupLog.mockRejectedValueOnce({ kind: "Query", message: "not authorized on local" });
    const v = createStartupLog("conn:1");
    await v.load();
    expect(v.entries).toEqual([]);
    expect(v.error).not.toBeNull();
  });
});
