import { describe, it, expect, vi } from "vitest";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(async () => ({ docs: [], total: 0 })),
  sampleDocuments: vi.fn(async () => []),
  replaceDocument: vi.fn(),
  deleteDocument: vi.fn(),
  fetchFullDoc: vi.fn(),
  countDocuments: vi.fn(async () => 0),
  updateMany: vi.fn(),
  updateOne: vi.fn(),
  deleteMany: vi.fn(),
  exportQueryProgress: vi.fn(),
}));

import { getCollectionView, disposeCollectionViews } from "./collectionViews.svelte";

describe("collectionViews registry", () => {
  it("returns the same store instance for the same session/db/coll/version", () => {
    const a = getCollectionView("s1", "db1", "coll1", 0);
    const b = getCollectionView("s1", "db1", "coll1", 0);
    expect(b.view).toBe(a.view);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    disposeCollectionViews("s1");
  });

  it("returns a distinct store when db/coll differs", () => {
    const a = getCollectionView("s1", "db1", "collA", 0);
    const b = getCollectionView("s1", "db1", "collB", 0);
    expect(b.view).not.toBe(a.view);
    disposeCollectionViews("s1");
  });

  it("returns a distinct store when version bumps (manual refresh)", () => {
    const a = getCollectionView("s1", "db1", "coll1", 0);
    const b = getCollectionView("s1", "db1", "coll1", 1);
    expect(b.view).not.toBe(a.view);
    expect(b.isNew).toBe(true);
    disposeCollectionViews("s1");
  });

  it("disposeCollectionViews only evicts entries for the given session", () => {
    const s1 = getCollectionView("s1", "db1", "coll1", 0);
    const s2 = getCollectionView("s2", "db1", "coll1", 0);
    disposeCollectionViews("s1");
    const s1Again = getCollectionView("s1", "db1", "coll1", 0);
    const s2Again = getCollectionView("s2", "db1", "coll1", 0);
    expect(s1Again.view).not.toBe(s1.view);
    expect(s2Again.view).toBe(s2.view);
    disposeCollectionViews("s1");
    disposeCollectionViews("s2");
  });
});
