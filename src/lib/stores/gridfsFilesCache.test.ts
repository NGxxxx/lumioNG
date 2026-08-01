import { describe, it, expect, vi } from "vitest";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(async () => []),
  countDocuments: vi.fn(async () => 0),
}));

import { getGridfsFiles, disposeGridfsFiles } from "./gridfsFilesCache.svelte";

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
});
