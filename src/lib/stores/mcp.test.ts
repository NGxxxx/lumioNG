import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/mcp", () => ({
  startMcp: vi.fn(async () => ({ running: true, port: 7737, allowWrites: false })),
  stopMcp: vi.fn(async () => {}),
  setMcpSessions: vi.fn(async () => {}),
}));

import { createMcp } from "./mcp.svelte";
import { startMcp, stopMcp, setMcpSessions } from "../api/mcp";
import { prefs } from "./prefs.svelte";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  prefs.clear();
  vi.clearAllMocks();
});

describe("mcp store", () => {
  it("starts off with a persisted fresh token and the default port", () => {
    const s = createMcp();
    expect(s.enabled).toBe(false);
    expect(s.status).toBe("off");
    expect(s.port).toBe(7737);
    expect(s.token).toHaveLength(48);
    expect(prefs.getItem("mcp-token")).toBe(s.token);
    expect(createMcp().token).toBe(s.token); // same token next launch
  });

  it("enabling starts the server and persists; disabling stops it", async () => {
    const s = createMcp();
    s.setEnabled(true);
    await flush();
    expect(startMcp).toHaveBeenCalledWith(7737, s.token, false, expect.any(Function));
    expect(s.status).toBe("running");
    expect(prefs.getItem("mcp-enabled")).toBe("true");
    s.setEnabled(false);
    await flush();
    expect(stopMcp).toHaveBeenCalled();
    expect(s.status).toBe("off");
  });

  it("init restarts the server only when it was left on", async () => {
    createMcp().init();
    expect(startMcp).not.toHaveBeenCalled();
    prefs.setItem("mcp-enabled", "true");
    createMcp().init();
    await flush();
    expect(startMcp).toHaveBeenCalledTimes(1);
  });

  it("a start failure surfaces as an error state", async () => {
    vi.mocked(startMcp).mockRejectedValueOnce({ kind: "Io", message: "cannot listen on 127.0.0.1:7737: in use" });
    const s = createMcp();
    s.setEnabled(true);
    await flush();
    expect(s.status).toBe("error");
    expect(s.error).toContain("in use");
  });

  it("settings changes restart a running server; invalid ports are refused", async () => {
    const s = createMcp();
    expect(s.setPort(80)).toBe(false);
    expect(s.setPort(9000)).toBe(true);
    expect(startMcp).not.toHaveBeenCalled(); // off: nothing to restart
    s.setEnabled(true);
    await flush();
    s.setAllowWrites(true);
    await flush();
    expect(startMcp).toHaveBeenLastCalledWith(9000, s.token, true, expect.any(Function));
    const old = s.token;
    s.regenerateToken();
    await flush();
    expect(s.token).not.toBe(old);
    expect(startMcp).toHaveBeenCalledTimes(3);
  });

  it("records activity reported by the server", async () => {
    const s = createMcp();
    s.setEnabled(true);
    await flush();
    const report = vi.mocked(startMcp).mock.calls[0][3];
    report({ tool: "find", connection: "Local", ok: true, ms: 12, error: null });
    expect(s.calls).toBe(1);
    expect(s.activity[0].tool).toBe("find");
    s.clearActivity();
    expect(s.activity).toEqual([]);
  });

  it("syncs sessions only when the list changes", async () => {
    const s = createMcp();
    const list = [{ id: "a", label: "Local", environment: "", readOnly: false }];
    s.syncSessions(list);
    s.syncSessions([...list]);
    expect(setMcpSessions).toHaveBeenCalledTimes(1);
    s.syncSessions([]);
    expect(setMcpSessions).toHaveBeenCalledTimes(2);
  });
});
