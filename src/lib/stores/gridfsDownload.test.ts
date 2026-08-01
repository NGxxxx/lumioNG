import { describe, it, expect, vi, beforeEach } from "vitest";

const gridfsDownloadMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const cancelMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const saveDialogMock = vi.fn(async (..._args: unknown[]): Promise<string | null> => "/tmp/out.bin");
vi.mock("../api/gridfs", () => ({ gridfsDownload: (...args: unknown[]) => gridfsDownloadMock(...args) }));
vi.mock("../api/documents", () => ({ cancelExportProgress: (...args: unknown[]) => cancelMock(...args) }));
vi.mock("../api/files", () => ({ saveDialog: (...args: unknown[]) => saveDialogMock(...args) }));

import { createGridfsDownload } from "./gridfsDownload.svelte";

describe("createGridfsDownload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prompts a save dialog, then downloads and reports progress", async () => {
    saveDialogMock.mockResolvedValueOnce("/tmp/out.bin");
    gridfsDownloadMock.mockImplementationOnce(async (_s, _db, _b, _doc, _total, _path, onProgress: unknown) => {
      (onProgress as (d: number, t: number) => void)(5, 10);
      (onProgress as (d: number, t: number) => void)(10, 10);
    });
    const job = createGridfsDownload("s1", "db1", "fs");
    await job.start({ filename: "a.txt" }, "a.txt", 10);
    expect(saveDialogMock).toHaveBeenCalledWith("a.txt", []);
    expect(gridfsDownloadMock).toHaveBeenCalledWith("s1", "db1", "fs", { filename: "a.txt" }, 10, "/tmp/out.bin", expect.any(Function));
    expect(job.status).toBe("done");
    expect(job.done).toBe(10);
    expect(job.total).toBe(10);
  });

  it("does nothing when the save dialog is cancelled", async () => {
    saveDialogMock.mockResolvedValueOnce(null);
    const job = createGridfsDownload("s1", "db1", "fs");
    await job.start({ filename: "a.txt" }, "a.txt", 10);
    expect(gridfsDownloadMock).not.toHaveBeenCalled();
    expect(job.status).toBe("idle");
  });

  it("marks status cancelled when the backend reports cancellation", async () => {
    gridfsDownloadMock.mockRejectedValueOnce({ kind: "Query", message: "Export cancelled" });
    const job = createGridfsDownload("s1", "db1", "fs");
    await job.start({ filename: "a.txt" }, "a.txt", 10);
    expect(job.status).toBe("cancelled");
  });

  it("marks status error for any other failure", async () => {
    gridfsDownloadMock.mockRejectedValueOnce({ kind: "Io", message: "disk full" });
    const job = createGridfsDownload("s1", "db1", "fs");
    await job.start({ filename: "a.txt" }, "a.txt", 10);
    expect(job.status).toBe("error");
    expect(job.error).toContain("disk full");
  });

  it("cancel() invokes cancelExportProgress only while a download is running", () => {
    const job = createGridfsDownload("s1", "db1", "fs");
    job.cancel();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
