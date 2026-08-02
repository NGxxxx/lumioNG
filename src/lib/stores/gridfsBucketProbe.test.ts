import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";

const countDocuments = vi.fn();
vi.mock("../api/documents", () => ({
  countDocuments: (...args: unknown[]) => countDocuments(...args),
}));

import { isGridfsFilesEmpty, disposeGridfsBucketProbes } from "./gridfsBucketProbe.svelte";

describe("gridfsBucketProbe", () => {
  beforeEach(() => {
    countDocuments.mockReset();
    disposeGridfsBucketProbes("s1");
  });

  it("returns null while unresolved, then the resolved verdict once the count comes back (empty)", async () => {
    countDocuments.mockResolvedValue(0);
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBe(true);
  });

  it("resolves to false when the collection actually has documents", async () => {
    countDocuments.mockResolvedValue(3);
    expect(isGridfsFilesEmpty("s1", "db1", "orders.files")).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(isGridfsFilesEmpty("s1", "db1", "orders.files")).toBe(false);
  });

  it("fails closed (not empty) if the count query itself errors", async () => {
    countDocuments.mockRejectedValue(new Error("boom"));
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBe(false);
  });

  it("coalesces concurrent probes for the same key into a single countDocuments call", async () => {
    countDocuments.mockResolvedValue(0);
    isGridfsFilesEmpty("s1", "db1", "fs.files");
    isGridfsFilesEmpty("s1", "db1", "fs.files");
    isGridfsFilesEmpty("s1", "db1", "fs.files");
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(countDocuments).toHaveBeenCalledTimes(1);
  });

  it("disposeGridfsBucketProbes only clears entries for the given session", async () => {
    countDocuments.mockResolvedValue(0);
    isGridfsFilesEmpty("s1", "db1", "fs.files");
    isGridfsFilesEmpty("s2", "db1", "fs.files");
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBe(true);
    expect(isGridfsFilesEmpty("s2", "db1", "fs.files")).toBe(true);

    disposeGridfsBucketProbes("s1");
    expect(isGridfsFilesEmpty("s1", "db1", "fs.files")).toBeNull(); // re-probes
    expect(isGridfsFilesEmpty("s2", "db1", "fs.files")).toBe(true); // untouched

    disposeGridfsBucketProbes("s2");
  });
});
