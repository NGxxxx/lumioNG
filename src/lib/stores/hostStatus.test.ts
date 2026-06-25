import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/server", () => ({ serverStatus: vi.fn(), buildInfo: vi.fn(), hostInfo: vi.fn() }));

import * as api from "../api/server";
import { createHostStatus } from "./hostStatus.svelte";

const serverStatus = api.serverStatus as ReturnType<typeof vi.fn>;
const buildInfo = api.buildInfo as ReturnType<typeof vi.fn>;
const hostInfo = api.hostInfo as ReturnType<typeof vi.fn>;

describe("createHostStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverStatus.mockResolvedValue(JSON.stringify({ version: "7.0.5", uptime: { $numberInt: "60" } }));
    buildInfo.mockResolvedValue(JSON.stringify({ version: "7.0.5" }));
    hostInfo.mockResolvedValue(JSON.stringify({ system: { hostname: "db-1" } }));
  });

  it("load populates curated info", async () => {
    const v = createHostStatus("conn:1");
    await v.load();
    expect(serverStatus).toHaveBeenCalledWith("conn:1");
    expect(v.info?.version).toBe("7.0.5");
    expect(v.info?.hostname).toBe("db-1");
    expect(v.error).toBeNull();
  });

  it("hostInfo rejection still yields info (soft-fail)", async () => {
    hostInfo.mockRejectedValueOnce({ kind: "Query", message: "not authorized" });
    const v = createHostStatus("conn:1");
    await v.load();
    expect(v.info?.version).toBe("7.0.5");
    expect(v.info?.hostname).toBeNull();
    expect(v.error).toBeNull();
  });

  it("clear resets state", async () => {
    const v = createHostStatus("conn:1");
    await v.load();
    v.clear();
    expect(v.info).toBeNull();
  });
});
