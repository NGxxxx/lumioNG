import { describe, it, expect, vi } from "vitest";
import { flushSync } from "svelte";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(async () => []),
  countDocuments: vi.fn(async () => 0),
}));

vi.mock("./gridfsFiles.svelte", () => ({
  createGridfsFiles: vi.fn(() => ({})),
}));

import { getGridfsFiles, disposeGridfsFiles } from "./gridfsFilesCache.svelte";
import { createGridfsFiles } from "./gridfsFiles.svelte";
import { createTrackedGridfsFiles } from "./gridfsFilesTestDouble.svelte";

describe("gridfsFilesCache registry", () => {
  it("returns the same store instance for the same session/db/bucket/version", () => {
    const a = getGridfsFiles("s1", "db1", "fs", 0);
    const b = getGridfsFiles("s1", "db1", "fs", 0);
    expect(b).toBe(a);
    disposeGridfsFiles("s1");
  });

  it("returns a distinct store when version bumps", () => {
    const a = getGridfsFiles("s1", "db1", "fs", 0);
    const b = getGridfsFiles("s1", "db1", "fs", 1);
    expect(b).not.toBe(a);
    disposeGridfsFiles("s1");
  });

  it("switching to a different bucket evicts the previous one's cached store (same session)", () => {
    const a = getGridfsFiles("s1", "db1", "fsA", 0);
    getGridfsFiles("s1", "db1", "fsB", 0);
    const aAgain = getGridfsFiles("s1", "db1", "fsA", 0);
    expect(aAgain).not.toBe(a);
    disposeGridfsFiles("s1");
  });

  it("disposeGridfsFiles only evicts entries for the given session", () => {
    const s1 = getGridfsFiles("s1", "db1", "fs", 0);
    const s2 = getGridfsFiles("s2", "db1", "fs", 0);
    disposeGridfsFiles("s1");
    expect(getGridfsFiles("s1", "db1", "fs", 0)).not.toBe(s1);
    expect(getGridfsFiles("s2", "db1", "fs", 0)).toBe(s2);
    disposeGridfsFiles("s1");
    disposeGridfsFiles("s2");
  });

  it("disposes the stale same-key entry's effect root before overwriting it on a version bump", () => {
    const disposeA = vi.fn();
    vi.mocked(createGridfsFiles).mockImplementationOnce(
      () => createTrackedGridfsFiles(disposeA) as unknown as ReturnType<typeof createGridfsFiles>,
    );
    const a = getGridfsFiles("s1", "db1", "fs", 0);
    flushSync(); // let the $effect registered inside store A's effect root actually run (setup registers the teardown)

    const disposeB = vi.fn();
    vi.mocked(createGridfsFiles).mockImplementationOnce(
      () => createTrackedGridfsFiles(disposeB) as unknown as ReturnType<typeof createGridfsFiles>,
    );
    const b = getGridfsFiles("s1", "db1", "fs", 1);
    flushSync();

    expect(b).not.toBe(a);
    // Regression: the old entry at the same key must be torn down, not merely overwritten/leaked.
    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).not.toHaveBeenCalled();

    disposeGridfsFiles("s1");
    expect(disposeB).toHaveBeenCalledTimes(1);
  });
});
