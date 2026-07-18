import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/sql", () => ({
  sqlImportPreview: vi.fn(),
  sqlImportCommit: vi.fn(),
}));

import * as api from "../api/sql";
import { createSqlImport } from "./sqlImport.svelte";
import { commandLog } from "./commandLog.svelte";

const sqlImportPreview = api.sqlImportPreview as ReturnType<typeof vi.fn>;
const sqlImportCommit = api.sqlImportCommit as ReturnType<typeof vi.fn>;

const preview = [
  { table: "users", columns: ["id", "name"], rowCount: 2 },
  { table: "orders", columns: ["id", "total"], rowCount: 5 },
];

describe("createSqlImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("loadPreview populates tables and selects all by default", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    expect(sqlImportPreview).toHaveBeenCalledWith("/tmp/dump.sql");
    expect(v.phase).toBe("selecting");
    expect(v.tables).toEqual(preview);
    expect(v.selected).toEqual(new Set(["users", "orders"]));
    expect(v.error).toBeNull();
  });

  it("loadPreview surfaces a parse error without throwing, and leaves \"loading\" so the error actually renders", async () => {
    sqlImportPreview.mockRejectedValueOnce({ kind: "Parse", message: "bad SQL" });
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    expect(v.error).toContain("bad SQL");
    expect(v.phase).toBe("selecting");
  });

  it("toggle removes/re-adds a table from the selection", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    v.toggle("orders");
    expect(v.selected).toEqual(new Set(["users"]));
    v.toggle("orders");
    expect(v.selected).toEqual(new Set(["users", "orders"]));
  });

  it("toggleAll clears then re-selects everything", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    v.toggleAll();
    expect(v.selected.size).toBe(0);
    v.toggleAll();
    expect(v.selected).toEqual(new Set(["users", "orders"]));
  });

  it("run commits only the selected tables and reports results", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    sqlImportCommit.mockResolvedValueOnce([
      { table: "users", inserted: 2, failed: 0, errors: [] },
    ]);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    v.toggle("orders"); // deselect orders — only users should be committed
    await v.run();
    expect(sqlImportCommit).toHaveBeenCalledWith(
      "conn:1", "d", "/tmp/dump.sql", ["users"], null, "skipDuplicates", expect.any(Function),
    );
    expect(v.phase).toBe("done");
    expect(v.results).toEqual([{ table: "users", inserted: 2, failed: 0, errors: [] }]);
  });

  it("run passes a pre-selected target collection through to the commit call", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    sqlImportCommit.mockResolvedValueOnce([]);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", "movies", "skipDuplicates");
    await v.loadPreview();
    await v.run();
    expect(sqlImportCommit).toHaveBeenCalledWith(
      "conn:1", "d", "/tmp/dump.sql", ["users", "orders"], "movies", "skipDuplicates", expect.any(Function),
    );
  });

  it("run does nothing when no table is selected", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    v.toggleAll(); // deselect all
    await v.run();
    expect(sqlImportCommit).not.toHaveBeenCalled();
    expect(v.phase).toBe("selecting");
  });

  it("run surfaces a commit error and returns to selecting", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    sqlImportCommit.mockRejectedValueOnce({ kind: "Query", message: "not writable" });
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    await v.run();
    expect(v.error).toContain("not writable");
    expect(v.phase).toBe("selecting");
  });

  it("run pushes a command-log entry with a measured duration", async () => {
    sqlImportPreview.mockResolvedValueOnce(preview);
    sqlImportCommit.mockResolvedValueOnce([]);
    const v = createSqlImport("conn:1", "d", "/tmp/dump.sql", null, "skipDuplicates");
    await v.loadPreview();
    await v.run();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
    expect(entry.text).toContain("users, orders");
  });
});
