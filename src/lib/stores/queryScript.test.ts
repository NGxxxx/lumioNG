import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/script", () => ({
  runScript: vi.fn(async () => ({
    console: [], result: { kind: "ack", json: "{}" },
    provenance: null, capped: false, error: null,
  })),
  cancelScript: vi.fn(),
}));

vi.mock("../api/documents", () => ({
  sampleDocuments: vi.fn(async () => [{ _id: { $oid: "1" }, name: "A", age: 30 }]),
  updateOne: vi.fn(async () => ({ matched: 1, modified: 1 })),
  deleteMany: vi.fn(async () => 1),
}));

import { runScript, cancelScript } from "../api/script";
import * as docsApi from "../api/documents";
import { createQueryScript } from "./queryScript.svelte";
import { settings } from "./settings.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { updateOneCmd, deleteManyCmd } from "../domain/mongosh";

const sampleDocuments = docsApi.sampleDocuments as ReturnType<typeof vi.fn>;
const updateOne = docsApi.updateOne as ReturnType<typeof vi.fn>;
const deleteMany = docsApi.deleteMany as ReturnType<typeof vi.fn>;

const ok = (rows: string[], prov: { db: string; coll: string } | null) => ({
  console: [{ level: "log", text: "hi" }],
  result: { kind: "docs", rows },
  provenance: prov,
  capped: false,
  error: null,
});

describe("destructive confirm", () => {
  beforeEach(() => {
    (runScript as any).mockClear();
    settings.setSuppressDestructiveWarning(false);
  });

  it("destructive script defers run and opens the confirm", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm?.ops).toContain("deleteMany");
  });

  it("confirmRun executes the deferred run", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    await s.confirmRun();
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.destructiveConfirm).toBeNull();
  });

  it("cancelConfirm clears without running", async () => {
    const s = createQueryScript("sess", "db.c.drop()");
    await s.run("mydb");
    s.cancelConfirm();
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm).toBeNull();
  });

  it("suppress flag bypasses the confirm", async () => {
    settings.setSuppressDestructiveWarning(true);
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.destructiveConfirm).toBeNull();
  });

  it("non-destructive script runs immediately", async () => {
    const s = createQueryScript("sess", "db.c.find({})");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledTimes(1);
  });
});

describe("createQueryScript", () => {
  beforeEach(() => vi.clearAllMocks());

  it("populates docs + columns + console on a docs result", async () => {
    (runScript as any).mockResolvedValue(ok([`{"_id":1,"a":2}`], { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    expect(s.docs.length).toBe(1);
    expect(s.consoleEntries.length).toBe(1);
    expect(s.displayMode).toBe("grid-editable");
    expect(s.provenance).toEqual({ db: "d", coll: "c" });
  });

  it("surfaces an engine error and clears running", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: "boom",
    });
    const s = createQueryScript("sess", "x");
    await s.run("d");
    expect(s.error).toBe("boom");
    expect(s.running).toBe(false);
  });

  it("requires a database", async () => {
    const s = createQueryScript("sess", "x");
    await s.run(null);
    expect(s.error).toMatch(/database/i);
    expect(runScript).not.toHaveBeenCalled();
  });

  it("cancel() calls cancelScript", () => {
    const s = createQueryScript("sess", "x");
    s.cancel();
    expect(cancelScript).toHaveBeenCalledWith("sess");
  });
});

describe("fieldsFor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("samples once and infers field paths", async () => {
    sampleDocuments.mockResolvedValueOnce([{ _id: { $oid: "1" }, name: "A", age: 30 }]);
    const s = createQueryScript("sess", "x");
    const fields = await s.fieldsFor("mydb", "mycoll");
    expect(sampleDocuments).toHaveBeenCalledWith("sess", "mydb", "mycoll", "{}", 50);
    expect(fields).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("caches per (db, coll): repeated calls do not re-sample", async () => {
    sampleDocuments.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    const s = createQueryScript("sess", "x");
    await s.fieldsFor("mydb", "mycoll");
    await s.fieldsFor("mydb", "mycoll");
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("de-dupes concurrent calls for the same key", async () => {
    sampleDocuments.mockResolvedValue([{ _id: { $oid: "1" }, x: 1 }]);
    const s = createQueryScript("sess", "x");
    await Promise.all([s.fieldsFor("mydb", "mycoll"), s.fieldsFor("mydb", "mycoll")]);
    expect(sampleDocuments).toHaveBeenCalledTimes(1);
  });

  it("returns [] when sampling fails", async () => {
    sampleDocuments.mockRejectedValueOnce(new Error("boom"));
    const s = createQueryScript("sess", "x");
    expect(await s.fieldsFor("mydb", "mycoll")).toEqual([]);
  });
});

describe("setSelection + hasSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hasSelection is true only for a non-empty, non-whitespace range", () => {
    const s = createQueryScript("sess", "db.c.find()");
    expect(s.hasSelection).toBe(false); // initial (no selection)
    s.setSelection(0, 5); // "db.c." — non-whitespace
    expect(s.hasSelection).toBe(true);
    s.setSelection(3, 3); // empty range
    expect(s.hasSelection).toBe(false);
  });

  it("hasSelection is false when selected range is only whitespace", () => {
    const s = createQueryScript("sess", "   db.c.find()");
    s.setSelection(0, 3); // "   " — pure whitespace
    expect(s.hasSelection).toBe(false);
  });
});

describe("runSelection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls runScript with the selected substring when hasSelection is true", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: null,
    });
    const s = createQueryScript("sess", "db.c.find() db.c.count()");
    s.setSelection(0, 11); // "db.c.find()"
    await s.runSelection("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()", expect.anything());
  });

  it("calls runScript with full statementText when no selection", async () => {
    (runScript as any).mockResolvedValue({
      console: [],
      result: { kind: "none" },
      provenance: null,
      capped: false,
      error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    // no setSelection → hasSelection is false
    await s.runSelection("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()", expect.anything());
  });
});

describe("execute forwards engine settings", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    settings.setQueryTimeoutMs(30000);
    settings.setQueryResultCap(1000);
    settings.setQueryResultCapUnlimited(false);
  });

  it("passes the configured timeout and cap to runScript", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "none" }, provenance: null, capped: false, error: null,
    });
    settings.setQueryTimeoutMs(7000);
    settings.setQueryResultCap(42);
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()", { timeoutMs: 7000, cap: 42 });
  });

  it("passes cap: 0 (unlimited) when queryResultCapUnlimited is on, ignoring the numeric cap", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "none" }, provenance: null, capped: false, error: null,
    });
    settings.setQueryResultCap(42);
    settings.setQueryResultCapUnlimited(true);
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    expect(runScript).toHaveBeenCalledWith("sess", "mydb", "db.c.find()", { timeoutMs: 30000, cap: 0 });
  });
});

describe("showAll / backToPaged", () => {
  it("showAll puts every fetched doc on one page; backToPaged restores normal paging", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => JSON.stringify({ n }));
    (runScript as any).mockResolvedValue(ok(rows, null));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    s.setPageSize(2);
    expect(s.pageDocs.length).toBe(2);
    expect(s.pageCount).toBe(3);

    s.showAll();
    expect(s.allShown).toBe(true);
    expect(s.pageDocs.length).toBe(5);
    expect(s.pageCount).toBe(1);
    expect(s.currentPage).toBe(1);

    s.backToPaged();
    expect(s.allShown).toBe(false);
    expect(s.pageDocs.length).toBe(2);
  });

  it("a new run resets allShown back to paged mode", async () => {
    const rows = [1, 2, 3].map((n) => JSON.stringify({ n }));
    (runScript as any).mockResolvedValue(ok(rows, null));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    s.showAll();
    expect(s.allShown).toBe(true);

    await s.run("mydb");
    expect(s.allShown).toBe(false);
  });
});

describe("console ergonomics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clearConsole empties the console entries", async () => {
    (runScript as any).mockResolvedValue({
      console: [{ level: "log", text: "hi" }], result: { kind: "none" },
      provenance: null, capped: false, error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    expect(s.consoleEntries.length).toBe(1);
    s.clearConsole();
    expect(s.consoleEntries.length).toBe(0);
  });

  it("records elapsed time for the last run", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "none" }, provenance: null, capped: false, error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    expect(s.lastElapsedMs).toBeNull();
    await s.run("d");
    expect(typeof s.lastElapsedMs).toBe("number");
    expect(s.lastElapsedMs as number).toBeGreaterThanOrEqual(0);
  });
});

describe("inline edit (editable grid)", () => {
  beforeEach(() => vi.clearAllMocks());

  const editableDocs = () => ok([`{"_id":1,"name":"A"}`, `{"_id":2,"name":"B"}`], { db: "d", coll: "c" });
  const readonlyDocs = () => ok([`{"name":"A"}`], null); // .map() result → no provenance

  it("startEdit is a no-op when the grid is read-only (no provenance)", async () => {
    (runScript as any).mockResolvedValue(readonlyDocs());
    const s = createQueryScript("sess", "db.c.find().map(x=>x)");
    await s.run("d");
    expect(s.displayMode).toBe("grid-readonly");
    s.startEdit(0, "name");
    expect(s.editing).toBeNull();
  });

  it("startEdit opens an editor for an editable scalar cell", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    expect(s.editing).toEqual({ row: 0, key: "name" });
    expect(s.editText).toBe("A");
  });

  it("commitEdit calls updateOne with the provenance namespace and patches the row immutably", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(1, "name");
    s.editText = "Z";
    await s.commitEdit();
    expect(updateOne).toHaveBeenCalledWith("sess", "d", "c", `{"_id": 2}`, `{"$set":{"name":"Z"}}`, false);
    expect(s.docs[1].name).toBe("Z");
    expect(s.docs[0].name).toBe("A");
    expect(s.editing).toBeNull();
  });

  it("commitEdit maps page-relative rows to absolute indices when paged", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => `{"_id":${i + 1},"name":"N${i}"}`);
    (runScript as any).mockResolvedValue(ok(rows, { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.setPageSize(2);   // page 1 = rows 0,1 ; page 2 = row 2
    s.goToPage(2);
    s.startEdit(0, "name"); // page-relative row 0 → absolute index 2
    s.editText = "ZZ";
    await s.commitEdit();
    expect(updateOne).toHaveBeenCalledWith("sess", "d", "c", `{"_id": 3}`, `{"$set":{"name":"ZZ"}}`, false);
    expect(s.docs[2].name).toBe("ZZ");
  });

  it("commitEdit on a nested field sends a dotted $set and patches the nested path locally", async () => {
    (runScript as any).mockResolvedValue(
      ok([`{"_id":1,"address":{"city":"Hue","zip":"1000"}}`], { db: "d", coll: "c" }),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "address.city");
    s.editText = "Hanoi";
    await s.commitEdit();
    expect(updateOne).toHaveBeenCalledWith(
      "sess", "d", "c", `{"_id": 1}`, `{"$set":{"address.city":"Hanoi"}}`, false,
    );
    expect((s.docs[0] as any).address).toEqual({ city: "Hanoi", zip: "1000" });
    expect(s.editing).toBeNull();
  });

  it("onEditBlur with unchanged text cancels silently (no confirm dialog)", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    s.onEditBlur();
    expect(s.editBlurPending).toBe(false);
    expect(s.editing).toBeNull();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("onEditBlur with changed text requests confirmation instead of saving immediately", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    s.editText = "Z";
    s.onEditBlur();
    expect(s.editBlurPending).toBe(true);
    expect(s.editing).not.toBeNull();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("confirmBlurEdit saves the pending change", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    s.editText = "Z";
    s.onEditBlur();
    await s.confirmBlurEdit();
    expect(updateOne).toHaveBeenCalled();
    expect(s.docs[0].name).toBe("Z");
    expect(s.editBlurPending).toBe(false);
    expect(s.editing).toBeNull();
  });

  it("discardBlurEdit discards the pending change", async () => {
    (runScript as any).mockResolvedValue(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    s.editText = "Z";
    s.onEditBlur();
    s.discardBlurEdit();
    expect(updateOne).not.toHaveBeenCalled();
    expect(s.docs[0].name).toBe("A");
    expect(s.editBlurPending).toBe(false);
    expect(s.editing).toBeNull();
  });

  it("execute resets editing to null when a new run starts", async () => {
    // First run: editable result with ≥2 rows so startEdit works
    (runScript as any).mockResolvedValueOnce(editableDocs());
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "name");
    expect(s.editing).toEqual({ row: 0, key: "name" });

    // Second run: another editable result (same size — guard `if (!doc)` won't fire)
    (runScript as any).mockResolvedValueOnce(editableDocs());
    await s.run("d");
    expect(s.editing).toBeNull();
  });
});

describe("selection / delete / menu (editable grid)", () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = async (prov: { db: string; coll: string } | null) => {
    (runScript as any).mockResolvedValue(
      ok([`{"_id":1,"name":"A"}`, `{"_id":2,"name":"B"}`, `{"_id":3,"name":"C"}`], prov),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    return s;
  };

  it("clickRow selects a single row; shift extends from the anchor", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.clickRow(0, { ctrl: false, shift: false });
    expect([...s.selected]).toEqual([0]);
    s.clickRow(2, { ctrl: false, shift: true });
    expect([...s.selected].sort()).toEqual([0, 1, 2]);
  });

  it("menuItems includes Edit/Delete when editable", async () => {
    const s = await setup({ db: "d", coll: "c" });
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "name");
    const actions = s.menuItems().map((i) => i.action);
    expect(actions).toContain("editCell");
    expect(actions).toContain("deleteSelected");
  });

  it("menuItems omits Edit/Delete/Open when read-only", async () => {
    const s = await setup(null);
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "name");
    const actions = s.menuItems().map((i) => i.action);
    expect(actions).not.toContain("editCell");
    expect(actions).not.toContain("deleteSelected");
    expect(actions).not.toContain("open");
    expect(actions).toContain("copyValue"); // copy still available
  });

  it("onMenuSelect copyValue copies the plain display value, not raw ExtJSON", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true });
    const s = await setup({ db: "d", coll: "c" });
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "name");
    s.onMenuSelect("copyValue");
    expect(writeText).toHaveBeenCalledWith("A"); // not "\"A\""
  });

  it("deleteSelected removes rows and calls deleteMany with the provenance namespace", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.clickRow(0, { ctrl: false, shift: false });
    s.clickRow(2, { ctrl: true, shift: false }); // select rows 0 and 2 (_id 1 and 3)
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "name");
    s.onMenuSelect("deleteSelected"); // opens confirm
    expect(s.confirmDelete?.count).toBe(2);
    await s.confirmDeleteRun();
    expect(deleteMany).toHaveBeenCalledWith("sess", "d", "c", `{"_id":{"$in":[1,3]}}`, false);
    expect(s.docs.map((d) => d._id)).toEqual([2]);
    expect([...s.selected]).toEqual([]);
  });
});

describe("queryScript command log + activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commandLog.clear();
  });

  it("execute pushes the exact script text that ran, with a measured duration", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "none" }, provenance: null, capped: false, error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    const entry = commandLog.entries.at(-1)!;
    expect(entry.text).toBe("db.c.find()");
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("execute begins/ends the shared activity indicator", async () => {
    let sawBusy = false;
    (runScript as any).mockImplementation(async () => {
      sawBusy = activity.busy;
      return { console: [], result: { kind: "none" }, provenance: null, capped: false, error: null };
    });
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });

  it("commitEdit pushes updateOneCmd to the command log with a measured duration", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "docs", rows: [`{"_id":1,"name":"A"}`] },
      provenance: { db: "d", coll: "c" }, capped: false, error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    commandLog.clear();
    s.startEdit(0, "name");
    s.editText = "Z";
    await s.commitEdit();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.text).toBe(updateOneCmd("c", `{"_id": 1}`, `{"$set":{"name":"Z"}}`));
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("deleteSelected pushes deleteManyCmd to the command log with a measured duration", async () => {
    (runScript as any).mockResolvedValue({
      console: [], result: { kind: "docs", rows: [`{"_id":1,"name":"A"}`, `{"_id":2,"name":"B"}`] },
      provenance: { db: "d", coll: "c" }, capped: false, error: null,
    });
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.clickRow(0, { ctrl: false, shift: false });
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "name");
    commandLog.clear();
    s.onMenuSelect("deleteSelected");
    await s.confirmDeleteRun();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.text).toBe(deleteManyCmd("c", `{"_id":{"$in":[1]}}`));
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });
});
