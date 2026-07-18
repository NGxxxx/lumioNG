import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";

vi.mock("../api/files", () => ({ openDialog: vi.fn(), importFileSize: vi.fn() }));
vi.mock("../api/documents", () => ({ importDocuments: vi.fn(), importBson: vi.fn() }));
vi.mock("../api/sql", () => ({ sqlImportPreview: vi.fn(), sqlImportCommit: vi.fn() }));
vi.mock("../api/csv", () => ({ csvImportPreview: vi.fn(), csvImportCommit: vi.fn() }));

import * as filesApi from "../api/files";
import * as documentsApi from "../api/documents";
import * as sqlApi from "../api/sql";
import * as csvApi from "../api/csv";
import ImportDialog from "./ImportDialog.svelte";

const openDialog = filesApi.openDialog as ReturnType<typeof vi.fn>;
const importFileSize = filesApi.importFileSize as ReturnType<typeof vi.fn>;
const importDocuments = documentsApi.importDocuments as ReturnType<typeof vi.fn>;
const sqlImportPreview = sqlApi.sqlImportPreview as ReturnType<typeof vi.fn>;
const csvImportPreview = csvApi.csvImportPreview as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  importFileSize.mockResolvedValue(0);
  importDocuments.mockResolvedValue({ inserted: 1, failed: 0, errors: [] });
  sqlImportPreview.mockResolvedValue([]);
  csvImportPreview.mockResolvedValue([]);
});

describe("ImportDialog — setup stage", () => {
  it("opens with no file chosen and Import disabled", () => {
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    expect(screen.getByText("No file chosen")).toBeTruthy();
    expect((screen.getByText("Import") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Browse opens the native picker with json/jsonl/bson/sql/csv filters for a collection-scoped import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(openDialog).toHaveBeenCalledWith([
      { name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] },
    ]);
    expect(screen.getByText("data.json")).toBeTruthy();
    expect((screen.getByText("Import") as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicking Import for a .csv file starts the CSV preview instead", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([
      { path: "id", inferredType: "int", samples: ["1", "2"] },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("id")).toBeTruthy();
    expect(csvImportPreview).toHaveBeenCalledWith(
      "/tmp/data.csv", "comma", { parseJsonLike: true, inferScalars: true },
    );
  });

  it("db-scoped import (coll=null) does not offer a .csv filter", async () => {
    openDialog.mockResolvedValueOnce(null);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: null, onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(openDialog).toHaveBeenCalledWith([{ name: "SQL", extensions: ["sql"] }]);
  });

  it("db-scoped import (coll=null) only offers a .sql filter and shows no Collection row", async () => {
    openDialog.mockResolvedValueOnce(null); // this test only checks the filter passed, not the resulting path
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: null, onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(openDialog).toHaveBeenCalledWith([{ name: "SQL", extensions: ["sql"] }]);
    expect(screen.queryByText("Collection")).toBeNull();
  });

  it("clicking Import for a JSON file starts the import job", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/data.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("choosing Upsert by _id before running forwards the chosen insert mode", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Upsert by _id"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/data.json", "upsertById", expect.any(Function)),
    );
  });

  it("clicking Import for a .sql file starts the SQL preview instead", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    // Extension flips the flow to SQL even for a collection-scoped invocation — notice appears immediately.
    expect(screen.getByText(/CREATE TABLE and INSERT INTO/)).toBeTruthy();
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() => expect(sqlImportPreview).toHaveBeenCalledWith("/tmp/dump.sql"));
  });

  it("Cancel in the setup stage closes without starting any import", async () => {
    const onclose = vi.fn();
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose } });
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onclose).toHaveBeenCalled();
    expect(importDocuments).not.toHaveBeenCalled();
  });
});

describe("ImportDialog — large-file confirm gate", () => {
  it("a large file shows a confirm notice instead of starting the import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText(/300\.0 MB/)).toBeTruthy();
    expect(importDocuments).not.toHaveBeenCalled();
  });

  it("Continue anyway on the large-file notice proceeds with the import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    await screen.findByText(/300\.0 MB/);
    await fireEvent.click(screen.getByText("Continue anyway"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/big.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("Cancel on the large-file notice returns to the unmodified setup stage", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    await screen.findByText(/300\.0 MB/);
    await fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/300\.0 MB/)).toBeNull();
    expect(importDocuments).not.toHaveBeenCalled();
  });
});

describe("ImportDialog — SQL multi-table target notice", () => {
  it("multi-table dump lists the new collections it will create", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([
      { table: "users", columns: [{ name: "id", inferredType: "int" }], rowCount: 2 },
      { table: "orders", columns: [{ name: "id", inferredType: "int" }], rowCount: 3 },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("Will create 2 new collection(s): users, orders.")).toBeTruthy();
  });

  it("single-table dump with a pre-selected collection shows the existing-collection message", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("Will import into existing collection films.")).toBeTruthy();
  });

  it("deselecting a table updates the new-collections list live", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([
      { table: "users", columns: [{ name: "id", inferredType: "int" }], rowCount: 2 },
      { table: "orders", columns: [{ name: "id", inferredType: "int" }], rowCount: 3 },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    await screen.findByText("Will create 2 new collection(s): users, orders.");
    // Checkbox order matches the table list: [0] select-all, [1] users, [2] orders.
    const checkboxes = screen.getAllByRole("checkbox");
    await fireEvent.click(checkboxes[2]);
    expect(await screen.findByText("Will create 1 new collection(s): users.")).toBeTruthy();
  });

  it("shows each table's per-column inferred types", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([
      {
        table: "users",
        columns: [
          { name: "id", inferredType: "int" },
          { name: "name", inferredType: "string" },
        ],
        rowCount: 2,
      },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText("id: int, name: string")).toBeTruthy();
  });
});
