import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({ sampleDocuments: vi.fn() }));

import * as api from "../api/documents";
import { createCollectionSchema } from "./collectionSchema.svelte";

const sampleDocuments = api.sampleDocuments as ReturnType<typeof vi.fn>;

describe("createCollectionSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sampleDocuments.mockResolvedValue([]);
  });

  it("init samples docs and infers field schema", async () => {
    sampleDocuments.mockResolvedValueOnce([
      { _id: { $oid: "a" }, name: "x", age: { $numberInt: "1" } },
      { _id: { $oid: "b" }, name: "y" },
    ]);
    const v = createCollectionSchema("conn:1", "shop", "users");
    await v.init();
    expect(sampleDocuments).toHaveBeenCalledWith("conn:1", "shop", "users", "{}", 100);
    expect(v.fields.map((f) => f.path)).toEqual(["_id", "name", "age"]);
    expect(v.fields.find((f) => f.path === "age")?.presence).toBe(0.5);
    expect(v.actualSampled).toBe(2);
    expect(v.error).toBeNull();
  });

  it("setSampleSize changes the requested size", async () => {
    const v = createCollectionSchema("conn:1", "shop", "users");
    v.setSampleSize(25);
    await v.refresh();
    expect(sampleDocuments).toHaveBeenCalledWith("conn:1", "shop", "users", "{}", 25);
  });

  it("setSampleSize clamps to a minimum of 1", async () => {
    const v = createCollectionSchema("conn:1", "shop", "users");
    v.setSampleSize(0);
    await v.refresh();
    expect(sampleDocuments).toHaveBeenCalledWith("conn:1", "shop", "users", "{}", 1);
  });

  it("api error sets error and does not throw", async () => {
    sampleDocuments.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionSchema("conn:1", "shop", "users");
    await v.refresh();
    expect(v.error).toContain("boom");
  });
});
