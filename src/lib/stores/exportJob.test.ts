import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  exportJsonProgress: vi.fn(),
  exportBsonProgress: vi.fn(),
  exportCsvProgress: vi.fn(),
  exportSqlProgress: vi.fn(),
  cancelExportProgress: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeTextFile: vi.fn() }));
const cmdlog = vi.hoisted(() => ({
  push: vi.fn(),
  pushTimed: vi.fn(async (text: string, sessionId: string, fn: () => Promise<unknown>) => {
    const result = await fn();
    cmdlog.push(text, sessionId, 0);
    return result;
  }),
}));
vi.mock("../api/documents", () => api);
vi.mock("../api/files", () => files);
vi.mock("./commandLog.svelte", () => ({ commandLog: cmdlog }));

import { createExportJob } from "./exportJob.svelte";
import { activity } from "./activity.svelte";

beforeEach(() => {
  api.exportJsonProgress.mockReset().mockResolvedValue(3);
  api.exportBsonProgress.mockReset().mockResolvedValue(2);
  api.exportCsvProgress.mockReset().mockResolvedValue(2);
  api.exportSqlProgress.mockReset().mockResolvedValue(1);
  api.cancelExportProgress.mockReset().mockResolvedValue(undefined);
  files.writeTextFile.mockReset().mockResolvedValue(undefined);
  cmdlog.push.mockReset();
});

const qSource = { kind: "query" as const, filter: "{}", sort: null, projection: null };

it("json target: backend writes file, row done with count", async () => {
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(api.exportJsonProgress).toHaveBeenCalledWith(
    "conn:1", "shop", "users", "{}", null, null, "/out/shop.users.json", expect.any(Function));
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(3);
  expect(job.done).toBe(true);
});

it("csv target: query source calls exportCsvProgress with the output path directly", async () => {
  const job = createExportJob("conn:1", {
    format: "csv", filePath: "/out/x.csv",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(api.exportCsvProgress).toHaveBeenCalledWith(
    "conn:1", "shop", "users", "{}", null, null, "/out/x.csv", expect.any(Function));
  expect(files.writeTextFile).not.toHaveBeenCalled();
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(2);
});

it("sql target: query source calls exportSqlProgress with the output path directly", async () => {
  const job = createExportJob("conn:1", {
    format: "sql", filePath: "/out/x.sql",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(api.exportSqlProgress).toHaveBeenCalledWith(
    "conn:1", "shop", "users", "{}", null, null, "/out/x.sql", expect.any(Function));
  expect(files.writeTextFile).not.toHaveBeenCalled();
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(1);
});

it("sql + memory source: table name comes from the target's coll", async () => {
  const job = createExportJob("conn:1", {
    format: "sql", filePath: "/out/r.sql",
    targets: [{ db: "", coll: "results", source: { kind: "memory", docs: [{ _id: 1, a: 1 }] } }],
  });
  await job.run();
  const [, content] = files.writeTextFile.mock.calls[0];
  expect(content).toContain('CREATE TABLE "results"');
  expect(job.rows[0].status).toBe("done");
});

it("memory source: serialize provided docs, no backend call", async () => {
  const job = createExportJob("conn:1", {
    format: "json", filePath: "/out/r.json",
    targets: [{ db: "", coll: "results", source: { kind: "memory", docs: [{ a: 1 }] } }],
  });
  await job.run();
  expect(api.exportJsonProgress).not.toHaveBeenCalled();
  expect(files.writeTextFile).toHaveBeenCalledWith("/out/r.json", expect.any(String));
  expect(job.rows[0].status).toBe("done");
});

it("one failure does not abort the batch", async () => {
  api.exportJsonProgress.mockRejectedValueOnce(new Error("boom"));
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [
      { db: "a", coll: "x", source: qSource },
      { db: "a", coll: "y", source: qSource },
    ],
  });
  await job.run();
  expect(job.rows[0].status).toBe("error");
  expect(job.rows[1].status).toBe("done");
  expect(job.failed).toBe(1);
  expect(job.succeeded).toBe(1);
});

it("cancel stops before the next target", async () => {
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [
      { db: "a", coll: "x", source: qSource },
      { db: "a", coll: "y", source: qSource },
    ],
  });
  api.exportJsonProgress.mockImplementationOnce(async () => { job.cancel(); return 3; });
  await job.run();
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[1].status).toBe("pending");
});

it("cancel while a target is running also asks the backend to interrupt it", async () => {
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [{ db: "a", coll: "x", source: qSource }],
  });
  api.exportJsonProgress.mockImplementationOnce(async () => { job.cancel(); return 3; });
  await job.run();
  expect(api.cancelExportProgress).toHaveBeenCalledWith("conn:1");
});

it("cancel before any target starts does not call the backend", () => {
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [{ db: "a", coll: "x", source: qSource }],
  });
  job.cancel();
  expect(api.cancelExportProgress).not.toHaveBeenCalled();
});

it("bson target: exportBsonProgress called, row done with count", async () => {
  const job = createExportJob("conn:1", {
    format: "bson", dir: "/out",
    targets: [{ db: "shop", coll: "orders", source: qSource }],
  });
  await job.run();
  expect(api.exportBsonProgress).toHaveBeenCalledWith(
    "conn:1", "shop", "orders", "{}", null, null, "/out/shop.orders.bson", expect.any(Function));
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(2);
});

it("run reports busy for the whole batch, not per-file", async () => {
  let sawBusyDuringFirst = false;
  api.exportJsonProgress.mockImplementationOnce(async () => {
    sawBusyDuringFirst = activity.busy;
    return 3;
  });
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [
      { db: "a", coll: "x", source: qSource },
      { db: "a", coll: "y", source: qSource },
    ],
  });
  await job.run();
  expect(sawBusyDuringFirst).toBe(true);
  expect(activity.busy).toBe(false);
});

it("live progress: onProg callback updates done/total", async () => {
  api.exportJsonProgress.mockImplementationOnce(
    async (sessionId: string, db: string, coll: string, f: string, s: string | null, p: string | null, path: string, onProg: (done: number, total: number) => void) => {
      onProg(5, 10);
      return 10;
    },
  );
  const job = createExportJob("conn:1", {
    format: "json", dir: "/out",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(job.rows[0].total).toBe(10);
  expect(job.rows[0].done).toBe(10);
});
