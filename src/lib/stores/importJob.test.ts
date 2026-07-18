import { describe, it, expect, beforeEach, vi } from "vitest";

const api = vi.hoisted(() => ({
  importDocuments: vi.fn(),
  importBson: vi.fn(),
}));
const cmdlog = vi.hoisted(() => ({
  push: vi.fn(),
  pushTimed: vi.fn(async (text: string, sessionId: string, fn: () => Promise<unknown>) => {
    const result = await fn();
    cmdlog.push(text, sessionId, 0);
    return result;
  }),
}));
vi.mock("../api/documents", () => api);
vi.mock("./commandLog.svelte", () => ({ commandLog: cmdlog }));

import { createImportJob } from "./importJob.svelte";
import { activity } from "./activity.svelte";

beforeEach(() => {
  api.importDocuments.mockReset().mockResolvedValue({ inserted: 3, failed: 0, errors: [] });
  api.importBson.mockReset().mockResolvedValue({ inserted: 2, failed: 0, errors: [] });
  cmdlog.push.mockReset();
});

describe("createImportJob", () => {
  it("routes .json/.jsonl files to importDocuments", async () => {
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/users.json", insertMode: "skipDuplicates" });
    await job.run();
    expect(api.importDocuments).toHaveBeenCalledWith(
      "conn:1", "shop", "users", "/in/users.json", "skipDuplicates", expect.any(Function));
    expect(api.importBson).not.toHaveBeenCalled();
    expect(job.result).toEqual({ inserted: 3, failed: 0, errors: [] });
    expect(job.finished).toBe(true);
    expect(job.running).toBe(false);
  });

  it("routes .bson files to importBson (case-insensitive extension)", async () => {
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/dump.BSON", insertMode: "skipDuplicates" });
    await job.run();
    expect(api.importBson).toHaveBeenCalledWith(
      "conn:1", "shop", "users", "/in/dump.BSON", "skipDuplicates", expect.any(Function));
    expect(api.importDocuments).not.toHaveBeenCalled();
    expect(job.result).toEqual({ inserted: 2, failed: 0, errors: [] });
  });

  it("live progress: onProgress callback updates done/total as it streams", async () => {
    api.importDocuments.mockImplementationOnce(
      async (sessionId: string, db: string, coll: string, path: string, insertMode: string, onProgress: (done: number, total: number) => void) => {
        onProgress(500, 2000);
        onProgress(2000, 2000);
        return { inserted: 2000, failed: 0, errors: [] };
      },
    );
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/big.json", insertMode: "skipDuplicates" });
    const runPromise = job.run();
    await runPromise;
    expect(job.total).toBe(2000);
    expect(job.done).toBe(2000);
  });

  it("a rejected import surfaces the error instead of a result", async () => {
    api.importDocuments.mockRejectedValueOnce(new Error("boom"));
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/users.json", insertMode: "skipDuplicates" });
    await job.run();
    expect(job.error).toBe("Error: boom");
    expect(job.result).toBeNull();
    expect(job.finished).toBe(true);
  });

  it("reports busy while running, not busy once finished", async () => {
    let sawBusy = false;
    api.importDocuments.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
      return { inserted: 1, failed: 0, errors: [] };
    });
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/users.json", insertMode: "skipDuplicates" });
    await job.run();
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });

  it("run() is a no-op once already running or finished", async () => {
    const job = createImportJob({ sessionId: "conn:1", db: "shop", coll: "users", path: "/in/users.json", insertMode: "skipDuplicates" });
    await job.run();
    await job.run();
    expect(api.importDocuments).toHaveBeenCalledTimes(1);
  });
});
