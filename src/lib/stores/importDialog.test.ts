import { describe, it, expect, vi, beforeEach } from "vitest";

const desktop = vi.hoisted(() => ({
  pickFile: vi.fn(),
  fileSize: vi.fn(),
  readOptionalTextFile: vi.fn(),
}));
vi.mock("./desktop", () => desktop);
vi.mock("../api/documents", () => ({ importDocuments: vi.fn(), importBson: vi.fn() }));
vi.mock("../api/csv", () => ({ csvImportPreview: vi.fn(), csvImportCommit: vi.fn() }));
vi.mock("../api/sql", () => ({ sqlImportPreview: vi.fn(), sqlImportCommit: vi.fn(), cancelSqlImport: vi.fn() }));
vi.mock("./metadataRestore", () => ({ restoreCollectionMetadata: vi.fn().mockResolvedValue(null) }));

import * as docsApi from "../api/documents";
import * as csvApi from "../api/csv";
import * as sqlApi from "../api/sql";
import { createImportDialog, importFormatOf } from "./importDialog.svelte";

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const make = (coll: string | null = "users") => createImportDialog({ sessionId: "s", db: "d", coll, existingCollections: ["users"] });

beforeEach(() => {
  vi.clearAllMocks();
  desktop.fileSize.mockResolvedValue(1000);
  desktop.readOptionalTextFile.mockResolvedValue(null);
  fn(docsApi.importDocuments).mockResolvedValue({ inserted: 3, failed: 0, errors: [] });
  fn(csvApi.csvImportPreview).mockResolvedValue([{ path: "id", inferredType: "int", samples: ["1"] }]);
  fn(csvApi.csvImportCommit).mockResolvedValue({ inserted: 1, failed: 0, errors: [] });
  fn(sqlApi.sqlImportPreview).mockResolvedValue([{ table: "t", columns: [], rowCount: 1 }]);
  fn(sqlApi.sqlImportCommit).mockResolvedValue({ tables: [{ table: "t", inserted: 1, failed: 0, errors: [] }], cancelled: false });
});

describe("importFormatOf", () => {
  it("goes by extension, case-insensitive, defaulting to JSON", () => {
    expect(["a.SQL", "a.csv", "a.bson", "a.jsonl", "a.json", "a.txt"].map(importFormatOf)).toEqual(["sql", "csv", "bson", "jsonl", "json", "json"]);
  });
});

describe("createImportDialog", () => {
  it("a JSON file is ready at once: one click from file to running import", async () => {
    const d = make();
    await d.setFile("/x/users.json");
    expect(d.format).toBe("json");
    expect(d.canStart).toBe(true);
    d.start();
    expect(d.view).toBe("run");
    await flush();
    expect(docsApi.importDocuments).toHaveBeenCalled();
    expect(d.finished).toBe(true);
  });

  it("the target is validated on the same screen", async () => {
    const d = make(null);
    await d.setFile("/x/a.json");
    expect(d.canStart).toBe(false);
    expect(d.targetError).toBe("err_coll_name_empty");
    d.target = "users";
    expect(d.targetPlan).toEqual({ kind: "existing", coll: "users" });
    d.target = "fresh";
    expect(d.targetPlan).toEqual({ kind: "new", coll: "fresh" });
    expect(d.canStart).toBe(true);
  });

  it("a large file shows a notice but doesn't add a step", async () => {
    desktop.fileSize.mockResolvedValue(500 * 1024 * 1024);
    const d = make();
    await d.setFile("/x/big.json");
    expect(d.large).toBe(true);
    expect(d.canStart).toBe(true);
  });

  it("finds the metadata sidecar and restores it by default", async () => {
    desktop.readOptionalTextFile.mockResolvedValue('{"indexes":[]}');
    const d = make();
    await d.setFile("/x/users.json");
    expect(desktop.readOptionalTextFile).toHaveBeenCalledWith("/x/users.metadata.json");
    expect(d.metadataBundle).toBe('{"indexes":[]}');
    d.start();
    await flush();
    expect(fn(docsApi.importDocuments).mock.calls.length).toBe(1);
  });

  it("CSV: preview loads on file choice; the target typed afterwards is the one imported into", async () => {
    const d = make(null);
    await d.setFile("/x/people.csv");
    await flush();
    expect(d.csv?.columns).toHaveLength(1);
    d.target = "people";
    expect(d.canStart).toBe(true);
    d.start();
    await flush();
    expect(fn(csvApi.csvImportCommit).mock.calls[0][2]).toBe("people");
  });

  it("SQL: tables load on file choice and need a selection", async () => {
    const d = make(null);
    await d.setFile("/x/dump.sql");
    await flush();
    expect(d.sql?.tables).toHaveLength(1);
    expect(d.canStart).toBe(d.sql!.selected.size > 0);
    if (d.sql!.selected.size === 0) d.sql!.toggleAll();
    expect(d.canStart).toBe(true);
  });

  it("a failed run goes back to the same options; a finished one can start over with another file", async () => {
    fn(docsApi.importDocuments).mockRejectedValueOnce({ kind: "Io", message: "bad file" });
    const d = make();
    await d.setFile("/x/users.json");
    d.insertMode = "upsertById";
    d.start();
    await flush();
    expect(d.failed).toBe(true);
    d.back();
    expect(d.view).toBe("setup");
    expect(d.path).toBe("/x/users.json");
    expect(d.insertMode).toBe("upsertById");
    d.start();
    await flush();
    expect(d.finished).toBe(true);
    d.importAnother();
    expect(d.path).toBe("");
    expect(d.target).toBe("users");
    expect(d.insertMode).toBe("upsertById");
  });

  it("changing the file while the size check is in flight keeps the newer file's answer", async () => {
    let release!: (n: number) => void;
    desktop.fileSize.mockReturnValueOnce(new Promise((r) => { release = r; })).mockResolvedValueOnce(10);
    const d = make();
    const first = d.setFile("/x/old.json");
    await d.setFile("/x/new.json");
    release(900 * 1024 * 1024);
    await first;
    expect(d.path).toBe("/x/new.json");
    expect(d.large).toBe(false);
  });
});
