import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/compare", () => ({
  compareStart: vi.fn(),
  comparePage: vi.fn(),
  compareDispose: vi.fn(async () => {}),
  compareCancel: vi.fn(async () => {}),
  syncApply: vi.fn(),
}));

import { compareStart, comparePage, compareCancel, compareDispose, syncApply } from "../api/compare";
import { createCompareView, type SessionLookup } from "./compareView.svelte";
import type { SyncReport } from "../domain/compare";
import type { Environment } from "../domain/environment";

const summary = { onlySrc: 2, onlyDst: 1, different: 3, same: 10, truncated: false };
const report = (dryRun: boolean): SyncReport => ({
  dryRun, planned: { insert: 2, replace: 3, delete: 0 }, applied: dryRun ? { insert: 0, replace: 0, delete: 0 } : { insert: 2, replace: 3, delete: 0 },
  failed: 0, errors: [], summary, cancelled: false, skipped: 0, typeConflicts: 0,
});

function setup(envs: Record<string, Environment> = { a: "dev", b: "dev" }, readOnly: Record<string, boolean> = {}) {
  const lookup: SessionLookup = (id) => (id in envs ? { label: id.toUpperCase(), environment: envs[id], readOnly: readOnly[id] ?? false } : undefined);
  const cv = createCompareView({ tabId: 7, src: { sessionId: "a", db: "shop", coll: "orders" }, sessionInfo: lookup });
  cv.dst.sessionId = "b";
  cv.dst.db = "shop";
  cv.dst.coll = "orders";
  return cv;
}

beforeEach(() => {
  vi.mocked(compareStart).mockReset().mockResolvedValue(summary);
  vi.mocked(comparePage).mockReset().mockResolvedValue({ total: 3, rows: [{ kind: "different", key: 1, src: { _id: 1, a: 1 }, dst: { _id: 1, a: 2 } }] });
  vi.mocked(syncApply).mockReset().mockImplementation(async (_id, _p, dry) => report(dry));
});

describe("compareView", () => {
  it("compares with the chosen sides, key, filter and ignored fields, then lists the differences", async () => {
    const cv = setup();
    cv.key = "sku";
    cv.filterText = '{"status":"A"}';
    cv.ignoreText = "updatedAt, meta.seen";
    await cv.compare();
    expect(compareStart).toHaveBeenCalledWith(
      "compare-7", { sessionId: "a", db: "shop", coll: "orders" }, { sessionId: "b", db: "shop", coll: "orders" },
      "sku", '{"status":"A"}', ["updatedAt", "meta.seen"], expect.any(Function),
    );
    expect(cv.summary).toEqual(summary);
    expect(cv.kind).toBe("different");
    expect(comparePage).toHaveBeenCalledWith("compare-7", "different", 0, 50);
    expect(cv.rows).toHaveLength(1);
    expect(cv.changes.map((c) => c.path)).toEqual(["a"]);
  });

  it("refuses to compare a collection with itself", async () => {
    const cv = setup();
    cv.dst.sessionId = "a";
    await cv.compare();
    expect(compareStart).not.toHaveBeenCalled();
    expect(cv.error).toBeTruthy();
  });

  it("sync needs a dry run of the current plan first", async () => {
    const cv = setup();
    expect(cv.canApply).toBe(false);
    await cv.dryRun();
    expect(syncApply).toHaveBeenCalledWith("compare-7", expect.objectContaining({ direction: "srcToDst", insertMissing: true, deleteExtra: false }), true, false, expect.any(Function));
    expect(cv.dryRunReport?.planned.replace).toBe(3);
    expect(cv.canApply).toBe(true);
    cv.deleteExtra = true; // any plan change voids the dry run
    expect(cv.canApply).toBe(false);
    cv.deleteExtra = false;
    expect(cv.canApply).toBe(true);
    cv.swapDirection();
    expect(cv.canApply).toBe(false);
  });

  it("a PROD destination must be confirmed by typing its name; only then is confirmed=true sent", async () => {
    const cv = setup({ a: "dev", b: "prod" });
    await cv.dryRun();
    expect(cv.target).toEqual({ sessionId: "b", db: "shop", coll: "orders" });
    expect(cv.targetEnv).toBe("prod");
    const pending = cv.requestApply();
    await vi.waitFor(() => expect(cv.gate.pending).not.toBeNull());
    expect(cv.gate.pending?.op).toBe("sync");
    expect(cv.gate.pending?.level).toBe("type");
    expect(cv.gate.pending?.env).toBe("prod");
    expect(cv.gate.pending?.target.detail).toContain("→");
    expect(syncApply).toHaveBeenCalledTimes(1); // the dry run only
    await pending;
    await cv.gate.confirm();
    expect(syncApply).toHaveBeenLastCalledWith("compare-7", expect.objectContaining({ direction: "srcToDst" }), false, true, expect.any(Function));
    expect(cv.syncReport?.applied.replace).toBe(3);
    expect(cv.canApply).toBe(false); // the dry run was used up
  });

  it("reversing the direction makes the source the written (and gated) side", async () => {
    const cv = setup({ a: "prod", b: "dev" });
    cv.swapDirection();
    expect(cv.target).toEqual({ sessionId: "a", db: "shop", coll: "orders" });
    expect(cv.targetEnv).toBe("prod");
    await cv.dryRun();
    void cv.requestApply();
    await vi.waitFor(() => expect(cv.gate.pending?.level).toBe("type"));
    expect(cv.gate.pending?.target.coll).toBe("orders");
    cv.gate.cancel();
    expect(syncApply).toHaveBeenCalledTimes(1);
  });

  it("a read-only written side cannot be synced", async () => {
    const cv = setup({ a: "dev", b: "dev" }, { b: true });
    expect(cv.targetReadOnly).toBe(true);
    await cv.dryRun();
    expect(syncApply).not.toHaveBeenCalled();
    expect(cv.canApply).toBe(false);
  });

  it("cancel and dispose address this compare tab only", async () => {
    const cv = setup();
    await cv.cancel();
    expect(compareCancel).toHaveBeenCalledWith("compare-7");
    cv.dispose();
    expect(compareDispose).toHaveBeenCalledWith("compare-7");
  });
});
