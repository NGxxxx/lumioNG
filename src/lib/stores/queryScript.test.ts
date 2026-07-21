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
  queryPage: vi.fn(),
  aggregate: vi.fn(),
  aggregateCount: vi.fn(),
  countDocuments: vi.fn(),
  explainQuery: vi.fn(),
}));

vi.mock("../api/indexes", () => ({
  createIndex: vi.fn(),
}));

import { runScript, cancelScript } from "../api/script";
import * as docsApi from "../api/documents";
import * as indexApi from "../api/indexes";
import { createQueryScript } from "./queryScript.svelte";
import { settings } from "./settings.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { updateOneCmd, deleteManyCmd } from "../domain/mongosh";

const sampleDocuments = docsApi.sampleDocuments as ReturnType<typeof vi.fn>;
const updateOne = docsApi.updateOne as ReturnType<typeof vi.fn>;
const deleteMany = docsApi.deleteMany as ReturnType<typeof vi.fn>;
const qp = docsApi.queryPage as ReturnType<typeof vi.fn>;
const agg = docsApi.aggregate as ReturnType<typeof vi.fn>;
const aggCount = docsApi.aggregateCount as ReturnType<typeof vi.fn>;
const cnt = docsApi.countDocuments as ReturnType<typeof vi.fn>;
const run = runScript as ReturnType<typeof vi.fn>;
const createIndexMock = indexApi.createIndex as ReturnType<typeof vi.fn>;
const explainQueryMock = docsApi.explainQuery as ReturnType<typeof vi.fn>;

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
    const s = createQueryScript("sess", "db.c.deleteMany({status:'old'})");
    await s.run("mydb");
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm?.ops).toContain("deleteMany");
  });

  it("confirmRun executes the deferred run", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({status:'old'})");
    await s.run("mydb");
    await s.confirmRun();
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.destructiveConfirm).toBeNull();
  });

  it("cancelConfirm clears without running", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({status:'old'})");
    await s.run("mydb");
    s.cancelConfirm();
    expect(runScript).not.toHaveBeenCalled();
    expect(s.destructiveConfirm).toBeNull();
  });

  it("suppress flag bypasses the confirm", async () => {
    settings.setSuppressDestructiveWarning(true);
    const s = createQueryScript("sess", "db.c.deleteMany({status:'old'})");
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

describe("critical confirm", () => {
  beforeEach(() => {
    (runScript as any).mockClear();
    settings.setSuppressDestructiveWarning(false);
  });

  it("a critical op (drop) defers run and opens the critical confirm, not the warn dialog", async () => {
    const s = createQueryScript("sess", "db.c.drop()");
    await s.run("mydb");
    expect(runScript).not.toHaveBeenCalled();
    expect(s.criticalConfirm?.ops).toContain("drop");
    expect(s.destructiveConfirm).toBeNull();
  });

  it("an empty-filter deleteMany is critical even though deleteMany is also warn-tier", async () => {
    const s = createQueryScript("sess", "db.c.deleteMany({})");
    await s.run("mydb");
    expect(s.criticalConfirm?.ops).toContain("deleteMany");
    expect(s.destructiveConfirm).toBeNull();
  });

  it("confirmCritical executes the deferred run", async () => {
    const s = createQueryScript("sess", "db.dropDatabase()");
    await s.run("mydb");
    await s.confirmCritical();
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(s.criticalConfirm).toBeNull();
  });

  it("cancelCritical clears without running", async () => {
    const s = createQueryScript("sess", "db.c.drop()");
    await s.run("mydb");
    s.cancelCritical();
    expect(runScript).not.toHaveBeenCalled();
    expect(s.criticalConfirm).toBeNull();
  });

  it("the suppress-warning setting does NOT bypass a critical confirm", async () => {
    settings.setSuppressDestructiveWarning(true);
    const s = createQueryScript("sess", "db.c.drop()");
    await s.run("mydb");
    expect(runScript).not.toHaveBeenCalled();
    expect(s.criticalConfirm?.ops).toContain("drop");
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
    expect(sampleDocuments).toHaveBeenCalledWith("sess", "mydb", "mycoll", "{}", 50, 30000);
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

describe("requestShowAll / exiting show-all via page navigation", () => {
  it("requestShowAll puts every fetched doc on one page; goToPage(1) restores normal paging", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => JSON.stringify({ n }));
    (runScript as any).mockResolvedValue(ok(rows, null));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    await s.setPageSize(2);
    expect(s.docs.length).toBe(2);
    expect(s.pageCount).toBe(3);

    await s.requestShowAll();
    expect(s.allShown).toBe(true);
    expect(s.docs.length).toBe(5);
    expect(s.pageCount).toBe(1);
    expect(s.currentPage).toBe(1);

    // Regression: ResultPager's "back to paged" button calls firstPage()/goToPage(1), not a
    // dedicated exit method — every page-navigation action must unconditionally drop showingAll,
    // otherwise the fully-shown result set gets silently truncated while allShown still reads true.
    await s.goToPage(1);
    expect(s.allShown).toBe(false);
    expect(s.docs.length).toBe(2);
  });

  it("nextPage() also exits show-all mode, not just goToPage", async () => {
    const rows = [1, 2, 3, 4, 5].map((n) => JSON.stringify({ n }));
    (runScript as any).mockResolvedValue(ok(rows, null));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    await s.setPageSize(2);

    await s.confirmShowAll();
    expect(s.allShown).toBe(true);
    expect(s.docs.length).toBe(5);

    await s.nextPage();
    expect(s.allShown).toBe(false);
    expect(s.docs.length).toBe(2);
  });

  it("a new run resets allShown back to paged mode", async () => {
    const rows = [1, 2, 3].map((n) => JSON.stringify({ n }));
    (runScript as any).mockResolvedValue(ok(rows, null));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("mydb");
    await s.requestShowAll();
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
    expect(s.editing).toEqual({ row: 0, key: "name", kind: "inline" });
    expect(s.editText).toBe("A");
  });

  it("startEdit on an object/array field opens the modal editor with pretty-printed JSON", async () => {
    (runScript as any).mockResolvedValue(ok([`{"_id":1,"tags":["a","b"]}`], { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "tags");
    expect(s.editing).toEqual({ row: 0, key: "tags", kind: "modal" });
    // Text is seeded a tick later (see startEdit) so the modal shell can paint first.
    expect(s.editTextLoading).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.editTextLoading).toBe(false);
    expect(s.editText).toBe(JSON.stringify(["a", "b"], null, 2));
  });

  it("commitEdit on a modal edit parses the JSON and $sets the field", async () => {
    (runScript as any).mockResolvedValue(ok([`{"_id":1,"tags":["a"]}`], { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.startEdit(0, "tags");
    s.editText = '["a","b","c"]';
    await s.commitEdit();
    expect(updateOne).toHaveBeenCalledWith("sess", "d", "c", `{"_id": 1}`, `{"$set":{"tags":["a","b","c"]}}`, false);
    expect(s.docs[0].tags).toEqual(["a", "b", "c"]);
    expect(s.editing).toBeNull();
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
    await s.setPageSize(2);   // page 1 = rows 0,1 ; page 2 = row 2
    await s.goToPage(2);
    s.startEdit(0, "name"); // page-relative row 0 on page 2 → the 3rd underlying doc
    s.editText = "ZZ";
    await s.commitEdit();
    expect(updateOne).toHaveBeenCalledWith("sess", "d", "c", `{"_id": 3}`, `{"$set":{"name":"ZZ"}}`, false);
    expect(s.docs[0].name).toBe("ZZ");
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
    expect(s.editing).toEqual({ row: 0, key: "name", kind: "inline" });

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

  it("onMenuSelect copyValue resolves an array-index menu key to the element", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true });
    (runScript as any).mockResolvedValue(
      ok([`{"_id":{"$oid":"1"},"tags":["x","y"]}`], { db: "d", coll: "c" }),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    const fakeEvent = { preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent;
    s.openMenu(fakeEvent, 0, "tags.1");
    s.onMenuSelect("copyValue");
    expect(writeText).toHaveBeenCalledWith("y");
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

describe("activeDataView bridge (canEditSelected/canDeleteSelected/getSelectedForEdit/requestDeleteSelected/requestExportCurrent)", () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = async (prov: { db: string; coll: string } | null) => {
    (runScript as any).mockResolvedValue(
      ok([`{"_id":1,"name":"A"}`, `{"_id":2,"name":"B"}`, `{"_id":3,"name":"C"}`], prov),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    return s;
  };

  it("canEditSelected is true only for exactly one selected row with an _id", async () => {
    const s = await setup({ db: "d", coll: "c" });
    expect(s.canEditSelected).toBe(false); // nothing selected yet
    s.clickRow(0, { ctrl: false, shift: false });
    expect(s.canEditSelected).toBe(true);
    s.clickRow(1, { ctrl: true, shift: false });
    expect(s.canEditSelected).toBe(false); // two rows selected
  });

  it("canEditSelected is false when the result isn't a live editable cursor", async () => {
    const s = await setup(null);
    s.clickRow(0, { ctrl: false, shift: false });
    expect(s.canEditSelected).toBe(false);
  });

  it("getSelectedForEdit returns the single selected doc, or null otherwise", async () => {
    const s = await setup({ db: "d", coll: "c" });
    expect(s.getSelectedForEdit()).toBeNull();
    s.clickRow(1, { ctrl: false, shift: false });
    expect(s.getSelectedForEdit()).toEqual({ _id: 2, name: "B" });
  });

  it("canDeleteSelected is true when every selected row has an _id", async () => {
    const s = await setup({ db: "d", coll: "c" });
    expect(s.canDeleteSelected).toBe(false);
    s.clickRow(0, { ctrl: false, shift: false });
    s.clickRow(2, { ctrl: true, shift: false });
    expect(s.canDeleteSelected).toBe(true);
  });

  it("requestDeleteSelected opens the confirm dialog for the current selection", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.clickRow(0, { ctrl: false, shift: false });
    s.clickRow(2, { ctrl: true, shift: false });
    s.requestDeleteSelected();
    expect(s.confirmDelete?.count).toBe(2);
  });

  it("requestExportCurrent exports the selection when non-empty", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.clickRow(1, { ctrl: false, shift: false });
    s.requestExportCurrent();
    const input = s.exportInput();
    expect(input?.mode).toBe("scopedMemory");
    expect(input && input.mode === "scopedMemory" ? input.docs : null).toEqual([{ _id: 2, name: "B" }]);
  });

  it("requestExportCurrent exports every loaded row when nothing is selected", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.requestExportCurrent();
    const input = s.exportInput();
    expect(input?.mode).toBe("scopedMemory");
    expect(input && input.mode === "scopedMemory" ? input.docs.length : null).toBe(3);
  });

  it("exportInput threads each column's inferred type through for the export nested-field notice", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.requestExportCurrent();
    const input = s.exportInput();
    expect(input?.mode).toBe("scopedMemory");
    if (input && input.mode === "scopedMemory") {
      // rawColumnFields here comes from mergeColumns(null, docs) — schema-less, so every column
      // is a "row-derived extra" with `type` left undefined by design (see ColumnField's own
      // doc comment in domain/schema.ts). This test exists to pin that current behavior so a
      // future change to mergeColumns's schema-less path doesn't silently break the export
      // notice without a failing test calling it out.
      expect(input.columns.every((c) => c.type === undefined)).toBe(true);
    }
  });

  it("invertSelection flips selected rows within the full 3-row result", async () => {
    const s = await setup({ db: "d", coll: "c" });
    s.clickRow(0, { ctrl: false, shift: false });
    expect([...s.selected]).toEqual([0]);
    s.invertSelection();
    expect([...s.selected].sort()).toEqual([1, 2]);
    s.invertSelection();
    expect([...s.selected]).toEqual([0]);
  });
});

describe("quick search (visibleIndices/searchInvalid)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const setup = async () => {
    (runScript as any).mockResolvedValue(
      ok([`{"_id":1,"name":"Alpha"}`, `{"_id":2,"name":"Beta"}`, `{"_id":3,"name":"Gamma"}`], { db: "d", coll: "c" }),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    return s;
  };

  it("visibleIndices is null (unfiltered) when searchTerm is empty", async () => {
    const s = await setup();
    expect(s.visibleIndices).toBeNull();
  });

  it("visibleIndices narrows to the matching rows for a valid regex, after the debounce", async () => {
    const s = await setup();
    s.searchTerm = "^(alpha|gamma)$";
    expect(s.visibleIndices).toBeNull(); // not yet applied — still debouncing
    vi.advanceTimersByTime(1000);
    expect(s.visibleIndices).toEqual([0, 2]);
    expect(s.searchInvalid).toBe(false);
  });

  it("searchInvalid is true for an invalid regex immediately (not debounced), and visibleIndices stays null", async () => {
    const s = await setup();
    s.searchTerm = "[unterminated";
    expect(s.searchInvalid).toBe(true);
    expect(s.visibleIndices).toBeNull();
  });
});

describe("quick search interacts safely with shift-click range-select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("never includes a row the active search filter hid", async () => {
    (runScript as any).mockResolvedValue(
      ok([
        `{"_id":0,"name":"A"}`, `{"_id":1,"name":"B"}`, `{"_id":2,"name":"C"}`,
        `{"_id":3,"name":"D"}`, `{"_id":4,"name":"E"}`,
      ], { db: "d", coll: "c" }),
    );
    const s = createQueryScript("sess", "db.c.find()");
    await s.run("d");
    s.searchTerm = "^[^2C]$"; // excludes doc index 2 only
    vi.advanceTimersByTime(1000);
    expect(s.visibleIndices).toEqual([0, 1, 3, 4]);
    s.clickRow(0, { ctrl: false, shift: false });
    s.clickRow(4, { ctrl: false, shift: true });
    expect([...s.selected].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
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

function cursorQueryOutcome(overrides: Partial<{
  cursorKind: "find" | "agg"; query: string; sort: string | null; projection: string | null;
  baseSkip: number; fixedLimit: number | null;
}> = {}) {
  return {
    console: [],
    result: {
      kind: "cursorQuery" as const,
      cursorKind: overrides.cursorKind ?? "find",
      db: "d", coll: "c",
      query: overrides.query ?? "{}",
      sort: overrides.sort ?? null,
      projection: overrides.projection ?? null,
      baseSkip: overrides.baseSkip ?? 0,
      fixedLimit: overrides.fixedLimit === undefined ? null : overrides.fixedLimit,
    },
    provenance: { db: "d", coll: "c" },
    capped: false,
    error: null,
  };
}

describe("createQueryScript — pure-cursor paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
    qp.mockResolvedValue([]);
    agg.mockResolvedValue([]);
    aggCount.mockResolvedValue(0);
  });

  it("a pure find() result counts and loads page 1 via query_page", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome());
    cnt.mockResolvedValueOnce(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    expect(v.docs).toEqual([{ _id: { $oid: "a" } }]);
    expect(v.totalCount).toBe(3);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenCalledWith("conn:1", "d", "c", 0, 50, "{}", null, null, 30000);
  });

  it("a pure aggregate() result counts via aggregateCount and pages via aggregate(skip, limit)", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome({ cursorKind: "agg", query: "[]" }));
    aggCount.mockResolvedValueOnce(120);
    agg.mockResolvedValueOnce([{ _id: { $oid: "p1" } }]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    expect(v.totalCount).toBe(120);
    expect(agg).toHaveBeenCalledWith("conn:1", "d", "c", "[]", 0, 50, 30000);
  });

  it("goToPage(3) re-fetches with the correct skip and replaces docs", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome());
    cnt.mockResolvedValueOnce(200);
    qp.mockResolvedValueOnce([{ _id: { $oid: "p1" } }]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]);
    await v.goToPage(3);
    expect(v.currentPage).toBe(3);
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 100, 50, "{}", null, null, 30000);
  });

  it("an explicit .limit() on the script hides the pager and fetches exactly that slice once", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome({ baseSkip: 10, fixedLimit: 5 }));
    qp.mockResolvedValueOnce([{ _id: { $oid: "x" } }]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    expect(qp).toHaveBeenCalledWith("conn:1", "d", "c", 10, 5, "{}", null, null, 30000);
    expect(cnt).not.toHaveBeenCalled();
    expect(v.pageCount).toBe(1);
    await v.goToPage(2);
    expect(qp).toHaveBeenCalledTimes(1); // pager is disabled: no second fetch
  });

  it("requestShowAll gates on the same threshold as collectionView, then fetches everything", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome());
    cnt.mockResolvedValue(6000); // over SHOW_ALL_WARN_THRESHOLD (5000)
    qp.mockResolvedValueOnce([]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    await v.requestShowAll();
    expect(v.showAllPending).toBe(6000);
    qp.mockResolvedValueOnce(Array.from({ length: 6000 }, (_, i) => ({ _id: { $oid: String(i) } })));
    await v.confirmShowAll();
    expect(v.allShown).toBe(true);
    expect(v.docs.length).toBe(6000);
  });

  it("regression: confirmShowAll surfaces a backend AppError object as readable text, not [object Object]", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome({ cursorKind: "agg", query: "[]" }));
    aggCount.mockResolvedValueOnce(6000); // over SHOW_ALL_WARN_THRESHOLD (5000)
    agg.mockResolvedValueOnce([]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    await v.requestShowAll();
    // Tauri invoke() rejects with the Rust AppError's JSON shape, not a JS Error instance —
    // e.g. a query that times out with the user's configured timeout.
    agg.mockRejectedValueOnce({ kind: "Query", message: "operation exceeded time limit" });
    await v.confirmShowAll();
    expect(v.error).toBe("Query: operation exceeded time limit");
  });

  it("a fresh run() clears a stale showAllPending left over from a previous run", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome());
    cnt.mockResolvedValue(6000); // over SHOW_ALL_WARN_THRESHOLD (5000)
    qp.mockResolvedValueOnce([]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    await v.requestShowAll();
    expect(v.showAllPending).toBe(6000); // still pending confirmation from the first run

    run.mockResolvedValueOnce(cursorQueryOutcome());
    qp.mockResolvedValueOnce([]);
    await v.run("d"); // a fresh run must not leave the old confirmation dialog dangling
    expect(v.showAllPending).toBeNull();
  });

  it("a non-pure (.map()) result is unaffected: docs come from runScript rows, no paging calls", async () => {
    run.mockResolvedValueOnce({
      console: [], result: { kind: "docs", rows: ['{"a":1}'] }, provenance: null, capped: false, error: null,
    });
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    expect(v.docs).toEqual([{ a: 1 }]);
    expect(qp).not.toHaveBeenCalled();
    expect(agg).not.toHaveBeenCalled();
  });

  it("requestShowAll no-ops when the recipe has a fixed limit (no count/fetch calls)", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome({ baseSkip: 10, fixedLimit: 5 }));
    qp.mockResolvedValueOnce([{ _id: { $oid: "x" } }]);
    const v = createQueryScript("conn:1", "");
    await v.run("d");
    expect(qp).toHaveBeenCalledTimes(1); // the fixed-limit page load from run()

    vi.clearAllMocks();
    await v.requestShowAll();
    expect(cnt).not.toHaveBeenCalled();
    expect(aggCount).not.toHaveBeenCalled();
    expect(qp).not.toHaveBeenCalled();
    expect(agg).not.toHaveBeenCalled();
    expect(v.allShown).toBe(false);
  });

  it("an out-of-order stale page response does not clobber a later page's docs (generation guard)", async () => {
    run.mockResolvedValueOnce(cursorQueryOutcome());
    cnt.mockResolvedValueOnce(200);
    qp.mockResolvedValueOnce([{ _id: { $oid: "p1" } }]); // initial page-1 load from run()
    const v = createQueryScript("conn:1", "");
    await v.run("d");

    // goToPage(2)'s fetch resolves LATE (after goToPage(3)'s fetch already resolved).
    let resolvePage2!: (docs: unknown[]) => void;
    const page2Promise = new Promise<unknown[]>((resolve) => { resolvePage2 = resolve; });
    qp.mockReturnValueOnce(page2Promise);

    const goToPage2 = v.goToPage(2); // starts the slow fetch, does not await yet

    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]); // goToPage(3)'s fetch resolves fast
    await v.goToPage(3);
    expect(v.currentPage).toBe(3);
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);

    // Now let the stale goToPage(2) fetch resolve — it must NOT overwrite the page-3 state.
    resolvePage2([{ _id: { $oid: "p2" } }]);
    await goToPage2;

    expect(v.currentPage).toBe(3);
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
  });
});

describe("explain", () => {
  beforeEach(() => vi.clearAllMocks());

  const pendingExplainHint = {
    cursorKind: "find" as const, db: "d", coll: "c",
    query: '{"status":"pending"}', sort: null, projection: null,
    skip: 0, limit: null,
  };

  async function runPureFind() {
    run.mockResolvedValue({
      console: [],
      result: {
        kind: "cursorQuery",
        cursorKind: "find", db: "d", coll: "c",
        query: '{"status":"pending"}', sort: null, projection: null,
        baseSkip: 0, fixedLimit: null,
      },
      provenance: { db: "d", coll: "c" },
      capped: false,
      error: null,
      explainHint: pendingExplainHint,
    });
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    const s = createQueryScript("sess", "db.c.find({status:'pending'})");
    await s.run("d");
    return s;
  }

  const collscanJson = JSON.stringify({
    queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
    executionStats: {
      nReturned: 0, executionTimeMillis: 20, totalDocsExamined: 1000,
      executionStages: { stage: "COLLSCAN", nReturned: 0, executionTimeMillisEstimate: 20, docsExamined: 1000 },
    },
  });
  const ixscanJson = JSON.stringify({
    queryPlanner: { winningPlan: { stage: "IXSCAN" } },
    executionStats: {
      nReturned: 0, executionTimeMillis: 1, totalDocsExamined: 0,
      executionStages: {
        stage: "IXSCAN", nReturned: 0, executionTimeMillisEstimate: 1, keysExamined: 0, indexName: "status_1",
      },
    },
  });

  it("canExplain is true only when a pure-cursor recipe exists", async () => {
    const s = await runPureFind();
    expect(s.canExplain).toBe(true);
  });

  it("canExplain is true for a .map()'d result that still carries an explainHint", async () => {
    run.mockResolvedValue({
      ...ok([`{"_id":1,"a":2}`], { db: "d", coll: "c" }),
      explainHint: pendingExplainHint,
    });
    const s = createQueryScript("sess", "db.c.find({status:'pending'}).map(x=>x)");
    await s.run("d");
    expect(s.canExplain).toBe(true);
  });

  it("canExplain is false when the outcome carries no explainHint (e.g. multiple queries)", async () => {
    run.mockResolvedValue(ok([`{"_id":1,"a":2}`], { db: "d", coll: "c" }));
    const s = createQueryScript("sess", "db.a.find(); db.b.find()");
    await s.run("d");
    expect(s.canExplain).toBe(false);
  });

  it("runExplain calls explainQuery with the recipe's exact fields and summarizes the result", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    await s.runExplain();
    expect(explainQueryMock).toHaveBeenCalledWith(
      "sess", "find", "d", "c", '{"status":"pending"}', null, null, 0, null, 30000,
    );
    expect(s.explainSummary?.verdict).toBe("collscan");
    expect(s.explainRawJson).toBe(collscanJson);
  });

  it("indexSuggestion is populated only for a collscan verdict", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    await s.runExplain();
    expect(s.indexSuggestion).toEqual({
      keys: { status: 1 },
      snippet: 'db.getCollection("c").createIndex({"status":1})',
    });
  });

  it("createSuggestedIndex creates the index, snapshots the previous summary, and re-runs explain", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValueOnce(collscanJson).mockResolvedValueOnce(ixscanJson);
    createIndexMock.mockResolvedValue(undefined);

    await s.runExplain();
    await s.createSuggestedIndex();

    expect(createIndexMock).toHaveBeenCalledWith("sess", "d", "c", '{"status":1}', false, null, false, null, null, null);
    expect(s.explainPrevSummary?.verdict).toBe("collscan");
    expect(s.explainSummary?.verdict).toBe("ixscan");
    expect(explainQueryMock).toHaveBeenCalledTimes(2);
  });

  it("createSuggestedIndex surfaces a failure via ioError without touching explainPrevSummary", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    await s.runExplain();
    createIndexMock.mockRejectedValue(new Error("index build failed"));

    await s.createSuggestedIndex();

    expect(s.ioError).toMatch(/index build failed/);
    expect(s.explainPrevSummary).toBeNull();
    expect(s.explainSummary?.verdict).toBe("collscan");
  });

  it("execute() resets all explain state on a fresh run", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    await s.runExplain();
    expect(s.explainSummary).not.toBeNull();

    await s.run("d");
    expect(s.explainSummary).toBeNull();
    expect(s.explainRawJson).toBeNull();
    expect(s.explainPrevSummary).toBeNull();
    expect(s.explainError).toBeNull();
  });

  it("ensureExplain fetches once, then does nothing on repeated calls while already loaded", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    s.ensureExplain();
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
    s.ensureExplain();
    s.ensureExplain();
    expect(explainQueryMock).toHaveBeenCalledTimes(1);
  });

  it("ensureExplain does not fire a second fetch while one is already in flight", async () => {
    const s = await runPureFind();
    let resolveExplain: (v: string) => void = () => {};
    explainQueryMock.mockReturnValue(new Promise<string>((resolve) => { resolveExplain = resolve; }));
    s.ensureExplain();
    s.ensureExplain();
    expect(explainQueryMock).toHaveBeenCalledTimes(1);
    resolveExplain(collscanJson);
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
  });

  it("a fresh run discards a stale in-flight explain instead of letting it overwrite the reset state", async () => {
    const s = await runPureFind();
    let resolveExplain: (v: string) => void = () => {};
    explainQueryMock.mockReturnValue(new Promise<string>((resolve) => { resolveExplain = resolve; }));
    const explainPromise = s.runExplain();
    // A fresh run starts while the above explain is still in flight.
    run.mockResolvedValue({
      console: [],
      result: {
        kind: "cursorQuery",
        cursorKind: "find", db: "d", coll: "c",
        query: '{"status":"active"}', sort: null, projection: null,
        baseSkip: 0, fixedLimit: null,
      },
      provenance: { db: "d", coll: "c" },
      capped: false,
      error: null,
    });
    await s.run("d");
    expect(s.explainSummary).toBeNull();
    expect(s.explainLoading).toBe(false);
    // The stale explain call now resolves — it must be discarded, not applied.
    resolveExplain(collscanJson);
    await explainPromise;
    expect(s.explainSummary).toBeNull();
  });

  it("showExplain bumps explainRequestSeq (for components outside the tab to react to) and fetches", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    const before = s.explainRequestSeq;
    s.showExplain();
    expect(s.explainRequestSeq).toBe(before + 1);
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
  });

  it("showExplain bumps explainRequestSeq again on a repeated call even while already loaded", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    s.showExplain();
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
    const seqAfterFirst = s.explainRequestSeq;
    s.showExplain();
    expect(s.explainRequestSeq).toBe(seqAfterFirst + 1);
    // Already loaded — ensureExplain's guard means no second fetch, only the signal re-fires.
    expect(explainQueryMock).toHaveBeenCalledTimes(1);
  });

  it("explainAfterRun runs the query first when not yet explainable, then fetches explain", async () => {
    run.mockResolvedValue({
      console: [],
      result: {
        kind: "cursorQuery",
        cursorKind: "find", db: "d", coll: "c",
        query: '{"status":"pending"}', sort: null, projection: null,
        baseSkip: 0, fixedLimit: null,
      },
      provenance: { db: "d", coll: "c" },
      capped: false,
      error: null,
      explainHint: pendingExplainHint,
    });
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    explainQueryMock.mockResolvedValue(collscanJson);
    const s = createQueryScript("sess", "db.c.find({status:'pending'})");
    expect(s.canExplain).toBe(false);

    await s.explainAfterRun("d");

    expect(run).toHaveBeenCalledWith("sess", "d", "db.c.find({status:'pending'})", expect.anything());
    expect(s.canExplain).toBe(true);
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
  });

  it("explainAfterRun does not re-run the query when already explainable", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    run.mockClear();

    await s.explainAfterRun("d");

    expect(run).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());
  });

  it("canExplain goes false after editing the statement without re-running", async () => {
    const s = await runPureFind();
    expect(s.canExplain).toBe(true);
    s.statementText = "db.c.find({status:'done'})";
    expect(s.canExplain).toBe(false);
  });

  it("canExplain stays true after Run Selection, even though the selection differs from statementText", async () => {
    run.mockResolvedValue({
      console: [],
      result: {
        kind: "cursorQuery",
        cursorKind: "find", db: "d", coll: "c",
        query: '{"status":"pending"}', sort: null, projection: null,
        baseSkip: 0, fixedLimit: null,
      },
      provenance: { db: "d", coll: "c" },
      capped: false,
      error: null,
      explainHint: pendingExplainHint,
    });
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    const s = createQueryScript("sess", "db.c.find({status:'pending'}) db.c.count()");
    s.setSelection(0, 27); // "db.c.find({status:'pending'})"
    await s.runSelection("d");
    // The selection substring never equals the full statementText — canExplain must not
    // key off that mismatch, only off whether the editor was touched since this run.
    expect(s.canExplain).toBe(true);
  });

  it("explainAfterRun re-runs and refreshes explain when the statement was edited since the last run", async () => {
    const s = await runPureFind();
    explainQueryMock.mockResolvedValue(collscanJson);
    await s.showExplain();
    await vi.waitFor(() => expect(s.explainSummary).not.toBeNull());

    s.statementText = "db.c.find({status:'done'})";
    run.mockResolvedValue({
      console: [],
      result: {
        kind: "cursorQuery",
        cursorKind: "find", db: "d", coll: "c",
        query: '{"status":"done"}', sort: null, projection: null,
        baseSkip: 0, fixedLimit: null,
      },
      provenance: { db: "d", coll: "c" },
      capped: false,
      error: null,
      explainHint: { ...pendingExplainHint, query: '{"status":"done"}' },
    });
    explainQueryMock.mockResolvedValue(ixscanJson);
    run.mockClear();

    await s.explainAfterRun("d");

    expect(run).toHaveBeenCalledWith("sess", "d", "db.c.find({status:'done'})", expect.anything());
    await vi.waitFor(() => expect(s.explainSummary?.verdict).toBe("ixscan"));
  });
});

describe("grid depth limit", () => {
  beforeEach(() => {
    (runScript as any).mockClear();
    settings.setGridMaxDepth(1);
  });
  afterEach(() => settings.setGridMaxDepth(1));

  it("collapses nested result columns at depth 1 and reacts to setting changes", async () => {
    run.mockResolvedValueOnce(
      ok([JSON.stringify({ _id: { $oid: "1" }, addr: { city: "HCM", geo: { lat: 1 } } })], null),
    );
    const s = createQueryScript("sess", "db.c.find({}).toArray()");
    await s.run("mydb");

    expect(s.columnFields.map((c) => c.path)).toEqual(["_id", "addr"]);
    expect(s.columnFields.find((c) => c.path === "addr")!.type).toBe("object");

    settings.setGridMaxDepth(null);
    expect(s.columnFields.map((c) => c.path)).toEqual(["_id", "addr.city", "addr.geo.lat"]);
  });
});
