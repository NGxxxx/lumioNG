import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/svelte";
import { handleModalKeydown } from "$lib/stores/modalStack";

vi.mock("../api/files", () => ({ openDialog: vi.fn(), importFileSize: vi.fn(), readTextFileIfExists: vi.fn() }));
vi.mock("../api/documents", () => ({ importDocuments: vi.fn(), importBson: vi.fn() }));
vi.mock("../api/sql", () => ({ sqlImportPreview: vi.fn(), sqlImportCommit: vi.fn() }));
vi.mock("../api/csv", () => ({ csvImportPreview: vi.fn(), csvImportCommit: vi.fn() }));
vi.mock("../stores/metadataRestore", () => ({ restoreCollectionMetadata: vi.fn() }));

import * as filesApi from "../api/files";
import * as documentsApi from "../api/documents";
import * as sqlApi from "../api/sql";
import * as csvApi from "../api/csv";
import ImportDialog from "./ImportDialog.svelte";

const openDialog = filesApi.openDialog as ReturnType<typeof vi.fn>;
const importFileSize = filesApi.importFileSize as ReturnType<typeof vi.fn>;
const readTextFileIfExists = filesApi.readTextFileIfExists as ReturnType<typeof vi.fn>;
const importDocuments = documentsApi.importDocuments as ReturnType<typeof vi.fn>;
const importBson = documentsApi.importBson as ReturnType<typeof vi.fn>;
const sqlImportPreview = sqlApi.sqlImportPreview as ReturnType<typeof vi.fn>;
const sqlImportCommit = sqlApi.sqlImportCommit as ReturnType<typeof vi.fn>;
const csvImportPreview = csvApi.csvImportPreview as ReturnType<typeof vi.fn>;
const csvImportCommit = csvApi.csvImportCommit as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  importFileSize.mockResolvedValue(0);
  readTextFileIfExists.mockResolvedValue(null);
  importDocuments.mockResolvedValue({ inserted: 1, failed: 0, errors: [] });
  importBson.mockResolvedValue({ inserted: 1, failed: 0, errors: [] });
  sqlImportPreview.mockResolvedValue([]);
  csvImportPreview.mockResolvedValue([]);
});

describe("ImportDialog — source stage", () => {
  it("opens with no file chosen and Next disabled", () => {
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    expect(screen.getByText("No file chosen")).toBeTruthy();
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Browse opens the native picker with json/jsonl/bson/sql/csv filters for a collection-scoped import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(openDialog).toHaveBeenCalledWith([
      { name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] },
    ]);
    expect(screen.getByText("data.json")).toBeTruthy();
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicking Next for a .csv file loads the CSV preview on the configure step", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([
      { path: "id", inferredType: "int", samples: ["1", "2"] },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("id")).toBeTruthy();
    expect(csvImportPreview).toHaveBeenCalledWith(
      "/tmp/data.csv", "comma", { parseJsonLike: true, inferScalars: true },
    );
  });

  it("db-scoped import (coll=null) offers the full file filter, same as a collection-scoped one", async () => {
    openDialog.mockResolvedValueOnce(null);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: null, onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(openDialog).toHaveBeenCalledWith([
      { name: "JSON / JSONL / BSON / SQL / CSV", extensions: ["json", "jsonl", "bson", "sql", "csv"] },
    ]);
  });

  it("collection-scoped import (coll set) shows an editable target-collection field pre-filled with coll, not a read-only row", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: "users", existingCollections: ["users", "orders"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    const input = screen.getByLabelText("Target collection") as HTMLInputElement;
    expect(input.value).toBe("users");
    await fireEvent.input(input, { target: { value: "users_backup" } });
    await fireEvent.click(screen.getByText("Next"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users_backup", "/tmp/data.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("db-scoped import (coll=null) with a non-SQL file shows a target-collection field, not the read-only Collection row", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users", "orders"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(screen.queryByText("Collection")).toBeNull();
    expect(screen.getByLabelText("Target collection")).toBeTruthy();
  });

  it("db-scoped import (coll=null) with a .sql file still skips the target-collection field", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(screen.queryByLabelText("Target collection")).toBeNull();
  });

  it("Next stays disabled for a db-scoped non-SQL file until a valid target-collection name is entered", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: null, onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "orders" } });
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("an invalid target-collection name blocks Next and shows an inline error", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: null, onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "system.foo" } });
    expect((screen.getByText("Next") as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText("Collection name cannot start with 'system.'.")).toBeTruthy();
  });

  it("the target-collection field suggests existingCollections via a datalist", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users", "orders"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    const input = screen.getByLabelText("Target collection") as HTMLInputElement;
    const datalist = document.getElementById(input.getAttribute("list")!) as HTMLDataListElement;
    expect([...datalist.options].map((o) => o.value)).toEqual(["users", "orders"]);
  });

  it("typing a name not in existingCollections shows the create-new-collection notice", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "orders_backup" } });
    expect(await screen.findByText("Will create new collection orders_backup.")).toBeTruthy();
  });

  it("typing a name that matches an existing collection shows the write-into-existing notice", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "users" } });
    expect(await screen.findByText("Will write into existing collection users.")).toBeTruthy();
  });

  it("a .bson file gets the same create-new-collection notice as JSON — BSON is not a second-class format", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.bson");
    render(ImportDialog, {
      props: { sessionId: "s", db: "d", coll: null, existingCollections: ["users"], onclose: vi.fn() },
    });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "archive" } });
    expect(await screen.findByText("Will create new collection archive.")).toBeTruthy();
    await fireEvent.click(screen.getByText("Next"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importBson).toHaveBeenCalledWith("s", "d", "archive", "/tmp/dump.bson", "skipDuplicates", expect.any(Function)),
    );
  });

  it("db-scoped import shows an \"Import into {db}\" title before a file is chosen", () => {
    render(ImportDialog, { props: { sessionId: "s", db: "shop", coll: null, onclose: vi.fn() } });
    expect(screen.getByRole("dialog", { name: "Import into shop" })).toBeTruthy();
  });

  it("Cancel in the source stage closes without starting any import", async () => {
    const onclose = vi.fn();
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose } });
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onclose).toHaveBeenCalled();
    expect(importDocuments).not.toHaveBeenCalled();
  });

  it("shows the detected format once a file is chosen, not before", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.bson");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    expect(screen.queryByText(/Format:/)).toBeNull();
    await fireEvent.click(screen.getByText("Browse…"));
    expect(screen.getByText("Format: BSON")).toBeTruthy();
  });

  it("shows a step indicator that advances with the wizard", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    expect(screen.getByText("Step 1 of 3: Source")).toBeTruthy();
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2 of 3: Configure")).toBeTruthy();
    await fireEvent.click(screen.getByText("Import"));
    expect(screen.getByText("Step 3 of 3: Run")).toBeTruthy();
  });
});

describe("ImportDialog — configure stage", () => {
  it("clicking Import for a JSON file starts the import job", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/data.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("choosing Upsert by _id before running forwards the chosen insert mode", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await fireEvent.click(screen.getByText("Upsert by _id"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/data.json", "upsertById", expect.any(Function)),
    );
  });

  it("clicking Next for a .sql file starts the SQL preview", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    // Extension flips the flow to SQL even for a collection-scoped invocation — notice appears immediately.
    expect(screen.getByText(/CREATE TABLE and INSERT INTO/)).toBeTruthy();
    await fireEvent.click(screen.getByText("Next"));
    await vi.waitFor(() => expect(sqlImportPreview).toHaveBeenCalledWith("/tmp/dump.sql"));
  });

  it("Back returns to the source stage without losing the chosen file", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Skip duplicates")).toBeTruthy();
    await fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("data.json")).toBeTruthy();
    expect(screen.queryByText("Skip duplicates")).toBeNull();
  });

  it("Cancel in the configure stage closes without starting any import", async () => {
    const onclose = vi.fn();
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await fireEvent.click(screen.getByText("Cancel"));
    expect(onclose).toHaveBeenCalled();
    expect(importDocuments).not.toHaveBeenCalled();
  });
});

describe("ImportDialog — Back-then-Next preserves configure state (unless the target changed)", () => {
  it("returning to Configure without changing the file keeps the SQL table selection and does not re-parse", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([
      { table: "users", columns: [{ name: "id", inferredType: "int" }], rowCount: 2 },
      { table: "orders", columns: [{ name: "id", inferredType: "int" }], rowCount: 3 },
    ]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will create 2 new collection(s): users, orders.");
    // Checkbox order matches the table list: [0] select-all, [1] users, [2] orders.
    const checkboxes = screen.getAllByRole("checkbox");
    await fireEvent.click(checkboxes[2]); // deselect "orders"
    await screen.findByText("Will create 1 new collection(s): users.");
    await fireEvent.click(screen.getByText("Back"));
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Will create 1 new collection(s): users.")).toBeTruthy();
    expect(sqlImportPreview).toHaveBeenCalledTimes(1);
  });

  it("returning to Configure without changing the CSV target keeps the chosen delimiter and does not re-parse", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValue([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Semicolon (;)"));
    await vi.waitFor(() => expect(csvImportPreview).toHaveBeenCalledTimes(2));
    await fireEvent.click(screen.getByText("Back"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    expect((screen.getByLabelText("Semicolon (;)") as HTMLInputElement).checked).toBe(true);
    expect(csvImportPreview).toHaveBeenCalledTimes(2); // unchanged — no reload from the Back+Next round trip
  });

  it("changing the target after Back forces a fresh CSV store instead of silently keeping the stale target", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValue([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    csvImportCommit.mockResolvedValueOnce({ inserted: 1, failed: 0, errors: [] });
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Back"));
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "users_backup" } });
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(csvImportCommit).toHaveBeenCalledWith(
        "s", "d", "users_backup", "/tmp/data.csv", "comma",
        { parseJsonLike: true, inferScalars: true }, "skipDuplicates", expect.any(Function),
      ),
    );
  });
});

describe("ImportDialog — large-file confirm gate", () => {
  it("a large file shows a confirm notice instead of advancing to configure", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText(/300\.0 MB/)).toBeTruthy();
    expect(importDocuments).not.toHaveBeenCalled();
  });

  it("Continue anyway on the large-file notice advances to configure, then Import starts it", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText(/300\.0 MB/);
    await fireEvent.click(screen.getByText("Continue anyway"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/big.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("Cancel on the large-file notice returns to the unmodified source stage", async () => {
    openDialog.mockResolvedValueOnce("/tmp/big.json");
    importFileSize.mockResolvedValueOnce(300 * 1024 * 1024);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
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
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Will create 2 new collection(s): users, orders.")).toBeTruthy();
  });

  it("single-table dump with a pre-selected collection shows the existing-collection message", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
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
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will create 2 new collection(s): users, orders.");
    // Checkbox order matches the table list: [0] select-all, [1] users, [2] orders.
    const checkboxes = screen.getAllByRole("checkbox");
    await fireEvent.click(checkboxes[2]);
    expect(await screen.findByText("Will create 1 new collection(s): users.")).toBeTruthy();
  });

  it("typing a target collection while multiple tables are selected forces everything into that one collection", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([
      { table: "users", columns: [{ name: "id", inferredType: "int" }], rowCount: 2 },
      { table: "orders", columns: [{ name: "id", inferredType: "int" }], rowCount: 3 },
    ]);
    sqlImportCommit.mockResolvedValueOnce({ tables: [], cancelled: false });
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will create 2 new collection(s): users, orders.");
    await fireEvent.input(screen.getByLabelText("Target collection"), { target: { value: "everything" } });
    expect(await screen.findByText("Will import into existing collection everything.")).toBeTruthy();
    await fireEvent.click(screen.getByText("Import 2 table(s)"));
    await vi.waitFor(() =>
      expect(sqlImportCommit).toHaveBeenCalledWith(
        "s", "d", "/tmp/dump.sql", ["users", "orders"], "everything", "skipDuplicates", expect.any(Function),
      ),
    );
  });

  it("clearing a single-table dump's pre-filled target reverts to creating a new collection", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    sqlImportCommit.mockResolvedValueOnce({ tables: [], cancelled: false });
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    const input = await screen.findByLabelText("Target collection");
    expect((input as HTMLInputElement).value).toBe("films");
    await fireEvent.input(input, { target: { value: "" } });
    expect(await screen.findByText("Will create 1 new collection(s): movie.")).toBeTruthy();
    await fireEvent.click(screen.getByText("Import 1 table(s)"));
    await vi.waitFor(() =>
      expect(sqlImportCommit).toHaveBeenCalledWith(
        "s", "d", "/tmp/dump.sql", ["movie"], null, "skipDuplicates", expect.any(Function),
      ),
    );
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
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("id: int, name: string")).toBeTruthy();
  });
});

describe("ImportDialog — insert mode forwarded per format (Finding 1)", () => {
  it("choosing Upsert by _id before running a SQL import forwards the chosen insert mode", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    sqlImportCommit.mockResolvedValueOnce({ tables: [], cancelled: false });
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will import into existing collection films.");
    await fireEvent.click(screen.getByText("Upsert by _id"));
    await fireEvent.click(screen.getByText("Import 1 table(s)"));
    await vi.waitFor(() =>
      expect(sqlImportCommit).toHaveBeenCalledWith(
        "s", "d", "/tmp/dump.sql", ["movie"], "films", "upsertById", expect.any(Function),
      ),
    );
  });

  it("choosing Upsert by _id before running a CSV import forwards the chosen insert mode", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    csvImportCommit.mockResolvedValueOnce({ inserted: 1, failed: 0, errors: [] });
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Upsert by _id"));
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(csvImportCommit).toHaveBeenCalledWith(
        "s", "d", "users", "/tmp/data.csv", "comma",
        { parseJsonLike: true, inferScalars: true }, "upsertById", expect.any(Function),
      ),
    );
  });
});

describe("ImportDialog — CSV preview-reload guard (Finding 2)", () => {
  it("disables the Import button while a delimiter-change reload is still in flight", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    let resolveReload!: (v: unknown) => void;
    const pending = new Promise((resolve) => { resolveReload = resolve; });
    csvImportPreview.mockReturnValueOnce(pending);
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    expect((screen.getByText("Import") as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(screen.getByText("Semicolon (;)"));
    // The old columns are still populated at this point, so only the new "loading" guard protects the button.
    expect((screen.getByText("Import") as HTMLButtonElement).disabled).toBe(true);
    resolveReload([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    await vi.waitFor(() => expect((screen.getByText("Import") as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("ImportDialog — run-stage error surfacing", () => {
  it("a failed SQL commit surfaces the error on the run stage instead of leaving it blank", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    sqlImportCommit.mockRejectedValueOnce(new Error("insert failed"));
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will import into existing collection films.");
    await fireEvent.click(screen.getByText("Import 1 table(s)"));
    expect(await screen.findByText(/insert failed/)).toBeTruthy();
    // The store reverts to "selecting" on failure, so canClose is already true — Close must stay usable.
    expect((screen.getByText("Close") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a failed CSV commit surfaces the error on the run stage instead of leaving it blank", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    csvImportCommit.mockRejectedValueOnce(new Error("duplicate key"));
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Import"));
    expect(await screen.findByText(/duplicate key/)).toBeTruthy();
    // The store reverts to "config" on failure, so canClose is already true — Close must stay usable.
    expect((screen.getByText("Close") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("ImportDialog — run-stage retry path (Finding 3)", () => {
  it("Back after a failed SQL commit returns to Configure, keeping the existing table selection instead of resetting to Source", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    sqlImportPreview.mockResolvedValueOnce([{ table: "movie", columns: [{ name: "id", inferredType: "int" }], rowCount: 5 }]);
    sqlImportCommit.mockRejectedValueOnce(new Error("insert failed"));
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "films", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("Will import into existing collection films.");
    await fireEvent.click(screen.getByText("Import 1 table(s)"));
    await screen.findByText(/insert failed/);
    await fireEvent.click(screen.getByText("Back"));
    // Configure stage content (table picker) is showing again, not the Source-stage file picker,
    // and the previously-selected table survived on the still-live sql store.
    expect(await screen.findByText("Import 1 table(s)")).toBeTruthy();
    expect(screen.queryByText("No file chosen")).toBeNull();
    expect(sqlImportPreview).toHaveBeenCalledTimes(1); // did not reconstruct the store / re-parse the file
  });

  it("Back after a failed CSV commit returns to Configure, keeping the existing column preview instead of resetting to Source", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.csv");
    csvImportPreview.mockResolvedValueOnce([{ path: "id", inferredType: "int", samples: ["1", "2"] }]);
    csvImportCommit.mockRejectedValueOnce(new Error("duplicate key"));
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    await screen.findByText("id");
    await fireEvent.click(screen.getByText("Import"));
    await screen.findByText(/duplicate key/);
    await fireEvent.click(screen.getByText("Back"));
    expect(await screen.findByText("id")).toBeTruthy(); // column preview still there
    expect(screen.queryByText("No file chosen")).toBeNull();
    expect(csvImportPreview).toHaveBeenCalledTimes(1); // did not reconstruct the store / re-parse the file
  });
});

describe("ImportDialog — metadata sidecar restore", () => {
  it("shows no restore checkbox when no companion metadata file exists", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText(/Restore indexes/)).toBeNull();
  });

  it("shows a checked-by-default restore checkbox when a companion metadata file exists, and restores it on import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    readTextFileIfExists.mockResolvedValueOnce('{"indexes":[]}');
    const { restoreCollectionMetadata } = await import("../stores/metadataRestore");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText(/Restore indexes & metadata from data\.metadata\.json/)).toBeTruthy();
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() =>
      expect(restoreCollectionMetadata).toHaveBeenCalledWith("s", "d", "users", '{"indexes":[]}'),
    );
  });

  it("unchecking the restore checkbox skips metadata restore", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    readTextFileIfExists.mockResolvedValueOnce('{"indexes":[]}');
    const { restoreCollectionMetadata } = await import("../stores/metadataRestore");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    await fireEvent.click(screen.getByText("Next"));
    const checkbox = await screen.findByText(/Restore indexes/);
    await fireEvent.click(checkbox.closest("label")!.querySelector("input")!);
    await fireEvent.click(screen.getByText("Import"));
    await vi.waitFor(() => expect(importDocuments).toHaveBeenCalled());
    expect(restoreCollectionMetadata).not.toHaveBeenCalled();
  });

  it("does not check for a companion metadata file for a .sql import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/dump.sql");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    expect(readTextFileIfExists).not.toHaveBeenCalled();
  });
});

describe("ImportDialog — keyboard", () => {
  it("Enter advances from source to configure, then starts the import", async () => {
    openDialog.mockResolvedValueOnce("/tmp/data.json");
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    await fireEvent.click(screen.getByText("Browse…"));
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    await screen.findByText("Skip duplicates");
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    await vi.waitFor(() =>
      expect(importDocuments).toHaveBeenCalledWith("s", "d", "users", "/tmp/data.json", "skipDuplicates", expect.any(Function)),
    );
  });

  it("Enter does nothing before a file is chosen", () => {
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose: vi.fn() } });
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    expect(importDocuments).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog in the source stage", () => {
    const onclose = vi.fn();
    render(ImportDialog, { props: { sessionId: "s", db: "d", coll: "users", onclose } });
    handleModalKeydown({ key: "Escape", target: null } as unknown as KeyboardEvent);
    expect(onclose).toHaveBeenCalled();
  });
});
