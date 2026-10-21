import { describe, it, expect, vi, beforeEach } from "vitest";
import { prefs } from "./prefs.svelte";
import { createWorkspaceRestore, SNAPSHOT_KEY, type RestoreDeps } from "./workspaceRestore.svelte";
import { snapshot, type LiveTab } from "../domain/workspaceSnapshot";

const tab = (connId: number, scriptText = "q"): LiveTab => ({ kind: "query", connId, db: "d", coll: null, filterText: "", scriptText });

function setup(over: Partial<RestoreDeps> = {}, current: LiveTab[] = []) {
  const deps: RestoreDeps = {
    capture: () => ({ tabs: current, active: null }),
    listSaved: async () => [
      { id: 1, label: "dev", environment: "dev" },
      { id: 2, label: "live", environment: "prod" },
    ],
    connect: vi.fn(async () => true),
    openTab: vi.fn(),
    activate: vi.fn(),
    onConnectFailed: vi.fn(),
    onUnlockCancelled: vi.fn(),
    ...over,
  };
  return { deps, store: createWorkspaceRestore(deps, 10) };
}

const store = (tabs: LiveTab[], active: number | null = null) => prefs.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot(tabs, active)));

beforeEach(() => prefs.removeItem(SNAPSHOT_KEY));

describe("workspaceRestore", () => {
  it("offers nothing and starts saving when there is no snapshot", async () => {
    const { store: s } = setup({}, [tab(1, "now")]);
    await s.init();
    expect(s.prompt).toBeNull();
    s.saveNow();
    expect(prefs.getItem(SNAPSHOT_KEY)).toContain("now");
  });

  it("does not overwrite the old snapshot before the offer is answered", async () => {
    store([tab(1, "old")]);
    const { store: s } = setup({}, []);
    await s.init();
    expect(s.prompt?.stage).toBe("restore");
    s.saveNow();
    expect(prefs.getItem(SNAPSHOT_KEY)).toContain("old");
  });

  it("reconnects dev, then asks about prod before touching it", async () => {
    store([tab(1, "a"), tab(2, "b")], 1);
    const { store: s, deps } = setup();
    await s.init();
    await s.accept();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(deps.connect).toHaveBeenCalledWith(1);
    expect(s.prompt?.stage).toBe("prod");
    await s.acceptProd();
    expect(deps.connect).toHaveBeenCalledWith(2);
    expect(deps.openTab).toHaveBeenCalledTimes(2);
    expect(deps.activate).toHaveBeenCalledWith(expect.objectContaining({ connId: 2, scriptText: "b" }));
    expect(s.prompt).toBeNull();
  });

  it("skipping the prod list never connects to it", async () => {
    store([tab(1), tab(2)]);
    const { store: s, deps } = setup();
    await s.init();
    await s.accept();
    s.declineProd();
    expect(deps.connect).not.toHaveBeenCalledWith(2);
    expect(s.prompt).toBeNull();
  });

  it("start fresh connects nothing and clears the snapshot on the next save", async () => {
    store([tab(1, "old")]);
    const { store: s, deps } = setup();
    await s.init();
    s.decline();
    expect(deps.connect).not.toHaveBeenCalled();
    expect(prefs.getItem(SNAPSHOT_KEY)).not.toContain("old");
  });

  it("reports a failed reconnect and skips that connection's tabs", async () => {
    store([tab(1)]);
    const { store: s, deps } = setup({ connect: vi.fn(async () => false) });
    await s.init();
    await s.accept();
    expect(deps.onConnectFailed).toHaveBeenCalledWith("dev");
    expect(deps.openTab).not.toHaveBeenCalled();
  });

  it("skips_remaining_connections_silently_after_cancelled_unlock_and_toasts_once", async () => {
    store([tab(1), tab(2)]);
    const { store: s, deps } = setup({
      listSaved: async () => [
        { id: 1, label: "dev", environment: "dev" },
        { id: 3, label: "dev2", environment: "staging" },
        { id: 2, label: "live", environment: "prod" },
      ],
      connect: vi.fn(async () => "cancelled" as const),
    });
    store([tab(1), tab(3), tab(2)]);
    await s.init();
    await s.accept();
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect(s.prompt).toBeNull();
    expect(deps.onConnectFailed).not.toHaveBeenCalled();
    expect(deps.openTab).not.toHaveBeenCalled();
    expect(deps.onUnlockCancelled).toHaveBeenCalledTimes(1);
  });

  it("settles when every connection of the snapshot was deleted", async () => {
    store([tab(9)]);
    const { store: s } = setup();
    await s.init();
    expect(s.prompt).toBeNull();
  });

  describe("onSettled (decides whether the Session Manager opens)", () => {
    it("reports 0 restored when there is no snapshot", async () => {
      const onSettled = vi.fn();
      const { store: s } = setup({ onSettled });
      await s.init();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("stays unsettled while the offer is open, then reports 0 when declined", async () => {
      store([tab(1)]);
      const onSettled = vi.fn();
      const { store: s } = setup({ onSettled });
      await s.init();
      expect(s.prompt).not.toBeNull();
      expect(onSettled).not.toHaveBeenCalled();
      s.decline();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("reports the restored connections when accepted", async () => {
      store([tab(1)]);
      const onSettled = vi.fn();
      const { store: s } = setup({ onSettled });
      await s.init();
      await s.accept();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("reports 0 when accepted but no connection could be restored", async () => {
      store([tab(1)]);
      const onSettled = vi.fn();
      const { store: s } = setup({ onSettled, connect: vi.fn(async () => false) });
      await s.init();
      await s.accept();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("reports 0 when the unlock was cancelled", async () => {
      store([tab(1)]);
      const onSettled = vi.fn();
      const { store: s } = setup({ onSettled, connect: vi.fn(async () => "cancelled" as const) });
      await s.init();
      await s.accept();
      expect(onSettled).toHaveBeenCalledExactlyOnceWith(0);
    });
  });
});
