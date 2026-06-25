import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  exportJsonProgress: vi.fn(),
  exportBsonProgress: vi.fn(),
  exportQueryProgress: vi.fn(),
}));
const files = vi.hoisted(() => ({ writeTextFile: vi.fn() }));
const cmdlog = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../api/documents", () => api);
vi.mock("../api/files", () => files);
vi.mock("./commandLog.svelte", () => ({ commandLog: cmdlog }));

import { createExportJob } from "./exportJob.svelte";

beforeEach(() => {
  api.exportJsonProgress.mockReset().mockResolvedValue(3);
  api.exportBsonProgress.mockReset().mockResolvedValue(2);
  api.exportQueryProgress.mockReset().mockResolvedValue([{ _id: 1 }, { _id: 2 }]);
  files.writeTextFile.mockReset().mockResolvedValue(undefined);
  cmdlog.push.mockReset();
});

const qSource = { kind: "query" as const, filter: "{}", sort: null, projection: null };

it("json target: backend writes file, row done with count", async () => {
  const job = createExportJob({
    format: "json", dir: "/out",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(api.exportJsonProgress).toHaveBeenCalledWith(
    "shop", "users", "{}", null, null, "/out/shop.users.json", expect.any(Function));
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(3);
  expect(job.done).toBe(true);
});

it("csv target: exportQueryProgress then writeTextFile", async () => {
  const job = createExportJob({
    format: "csv", filePath: "/out/x.csv",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(api.exportQueryProgress).toHaveBeenCalled();
  expect(files.writeTextFile).toHaveBeenCalledWith("/out/x.csv", expect.any(String));
  expect(job.rows[0].status).toBe("done");
});

it("memory source: serialize provided docs, no backend call", async () => {
  const job = createExportJob({
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
  const job = createExportJob({
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
  const job = createExportJob({
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

it("bson target: exportBsonProgress called, row done with count", async () => {
  const job = createExportJob({
    format: "bson", dir: "/out",
    targets: [{ db: "shop", coll: "orders", source: qSource }],
  });
  await job.run();
  expect(api.exportBsonProgress).toHaveBeenCalledWith(
    "shop", "orders", "{}", null, null, "/out/shop.orders.bson", expect.any(Function));
  expect(job.rows[0].status).toBe("done");
  expect(job.rows[0].done).toBe(2);
});

it("live progress: onProg callback updates done/total", async () => {
  api.exportJsonProgress.mockImplementationOnce(
    async (db: string, coll: string, f: string, s: string | null, p: string | null, path: string, onProg: (done: number, total: number) => void) => {
      onProg(5, 10);
      return 10;
    },
  );
  const job = createExportJob({
    format: "json", dir: "/out",
    targets: [{ db: "shop", coll: "users", source: qSource }],
  });
  await job.run();
  expect(job.rows[0].total).toBe(10);
  expect(job.rows[0].done).toBe(10);
});
