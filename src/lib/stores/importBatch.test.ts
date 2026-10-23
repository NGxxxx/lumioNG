import { describe, it, expect, vi, beforeEach } from "vitest";

const desktop = vi.hoisted(() => ({ readOptionalTextFile: vi.fn() }));
vi.mock("./desktop", () => desktop);
vi.mock("../api/documents", () => ({ importDocuments: vi.fn(), importBson: vi.fn() }));
vi.mock("../api/csv", () => ({ csvImportPreview: vi.fn(), csvImportCommit: vi.fn() }));
vi.mock("./metadataRestore", () => ({ restoreCollectionMetadata: vi.fn().mockResolvedValue(null) }));

import * as docsApi from "../api/documents";
import * as csvApi from "../api/csv";
import { restoreCollectionMetadata } from "./metadataRestore";
import { createImportBatch } from "./importBatch.svelte";

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  desktop.readOptionalTextFile.mockResolvedValue(null);
  fn(docsApi.importDocuments).mockResolvedValue({ inserted: 3, failed: 0, errors: [] });
  fn(docsApi.importBson).mockResolvedValue({ inserted: 5, failed: 0, errors: [] });
  fn(csvApi.csvImportPreview).mockResolvedValue([{ path: "id", inferredType: "int", samples: ["1"] }]);
  fn(csvApi.csvImportCommit).mockResolvedValue({ inserted: 2, failed: 0, errors: [] });
});

describe("createImportBatch", () => {
  it("imports each data file into a collection named after it, applying mongodump sidecars", async () => {
    desktop.readOptionalTextFile.mockImplementation(async (p: string) => (p.endsWith("orders.metadata.json") ? '{"indexes":[]}' : null));
    const b = createImportBatch({ sessionId: "s", db: "shop", paths: ["/d/orders.bson", "/d/orders.metadata.json", "/d/users.json", "/d/tags.csv", "/d/dump.sql"] });
    expect(b.importable).toBe(3);
    expect(b.canStart).toBe(true);
    await b.run();
    expect(fn(docsApi.importBson).mock.calls[0].slice(0, 4)).toEqual(["s", "shop", "orders", "/d/orders.bson"]);
    expect(fn(docsApi.importDocuments).mock.calls[0].slice(0, 4)).toEqual(["s", "shop", "users", "/d/users.json"]);
    expect(fn(csvApi.csvImportCommit).mock.calls[0].slice(0, 4)).toEqual(["s", "shop", "tags", "/d/tags.csv"]);
    expect(restoreCollectionMetadata).toHaveBeenCalledWith("s", "shop", "orders", '{"indexes":[]}');
    expect(b.rows.map((r) => [r.fileName, r.status, r.inserted])).toEqual([
      ["orders.bson", "done", 5],
      ["tags.csv", "done", 2],
      ["users.json", "done", 3],
      ["dump.sql", "skipped", 0],
      ["orders.metadata.json", "skipped", 0],
    ]);
    expect(b.finished).toBe(true);
  });

  it("blocks the start while two files target the same collection, and allows renaming", () => {
    const b = createImportBatch({ sessionId: "s", db: "d", paths: ["/a/x.json", "/b/x.jsonl"] });
    expect(b.canStart).toBe(false);
    expect(b.errors).toEqual(["err_coll_name_duplicate", "err_coll_name_duplicate"]);
    b.setColl(1, "x2");
    expect(b.canStart).toBe(true);
  });

  it("marks a failed file; cancel stops before the next file", async () => {
    fn(docsApi.importDocuments).mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const b = createImportBatch({ sessionId: "s", db: "d", paths: ["/a/a.json", "/a/b.json", "/a/c.json"] });
    const run = b.run();
    b.cancel(); // requested while the first file runs
    await run;
    expect(b.rows.map((r) => r.status)).toEqual(["failed", "cancelled", "cancelled"]);
  });

  it("keeps going after a failed file when not cancelled", async () => {
    fn(docsApi.importDocuments).mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const b = createImportBatch({ sessionId: "s", db: "d", paths: ["/a/a.json", "/a/b.json"] });
    await b.run();
    expect(b.rows.map((r) => [r.status, r.error])).toEqual([["failed", "Query: boom"], ["done", null]]);
  });
});
