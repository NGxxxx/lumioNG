import { describe, it, expect, vi, beforeEach } from "vitest";
import { countDocuments, updateMany, deleteMany } from "../api/documents";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(),
  sampleDocuments: vi.fn(),
  replaceDocument: vi.fn(),
  deleteDocument: vi.fn(),
  fetchFullDoc: vi.fn(),
  countDocuments: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  exportQuery: vi.fn(),
  exportBson: vi.fn(),
}));

vi.mock("../api/files", () => ({
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  writeTextFile: vi.fn(),
}));

import * as documents from "../api/documents";
import * as files from "../api/files";
import { createCollectionView } from "./collectionView.svelte";
import { commandLog } from "./commandLog.svelte";
import { findCmd, deleteOneCmd } from "../domain/mongosh";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const del = documents.deleteDocument as ReturnType<typeof vi.fn>;
const repl = documents.replaceDocument as ReturnType<typeof vi.fn>;
const samp = documents.sampleDocuments as ReturnType<typeof vi.fn>;
const full = documents.fetchFullDoc as ReturnType<typeof vi.fn>;
const expQ = documents.exportQuery as ReturnType<typeof vi.fn>;
const exportBsonMock = documents.exportBson as ReturnType<typeof vi.fn>;
const exportQueryMock = documents.exportQuery as ReturnType<typeof vi.fn>;
const cnt = documents.countDocuments as ReturnType<typeof vi.fn>;
const saveDlg = files.saveDialog as ReturnType<typeof vi.fn>;
const writeF = files.writeTextFile as ReturnType<typeof vi.fn>;

describe("createCollectionView — paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("init: counts total, loads page 1 (skip 0), and derives columns", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.docs.length).toBe(1);
    expect(v.totalCount).toBe(1);
    expect(v.currentPage).toBe(1);
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(qp).toHaveBeenCalledWith("d", "c", 0, 50, "{}", null, null);
  });

  it("goToPage(3) calls queryPage with the correct skip and replaces docs", async () => {
    cnt.mockResolvedValue(200); // pageCount = 4
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]); // init trang 1
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]);
    await v.goToPage(3);
    expect(v.currentPage).toBe(3);
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 100, 50, "{}", null, null);
  });

  it("goToPage past pageCount → clamps to the last page", async () => {
    cnt.mockResolvedValue(100); // pageCount = 2
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.goToPage(99);
    expect(v.currentPage).toBe(2);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 50, 50, "{}", null, null);
  });

  it("nextPage/prevPage navigate between pages", async () => {
    cnt.mockResolvedValue(200);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.nextPage();
    expect(v.currentPage).toBe(2);
    await v.prevPage();
    expect(v.currentPage).toBe(1);
  });

  it("loadPage error → error is set", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.error).toBe("Query: boom");
  });

  it("applyFilter with invalid syntax → sets filterError, does not call queryPage", async () => {
    const v = createCollectionView("d", "c");
    v.filterText = "{bad";
    await v.applyFilter();
    expect(v.filterError).not.toBeNull();
    expect(qp).not.toHaveBeenCalled();
  });

  it("applyFilter with valid input → resets to page 1 and queries with the new filter", async () => {
    cnt.mockResolvedValue(5);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValue([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    v.filterText = '{"x":2}';
    await v.applyFilter();
    expect(v.filterError).toBeNull();
    expect(v.currentPage).toBe(1);
    expect(v.docs.length).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, '{"x":2}', null, null);
    expect(samp).toHaveBeenLastCalledWith("d", "c", '{"x":2}', 100);
  });

  it("applyFilter while a page is loading → discards the stale result and uses the new filter", async () => {
    cnt.mockResolvedValue(5);
    let resolveOld!: (v: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    samp.mockResolvedValue([]);
    const v = createCollectionView("d", "c");
    const p1 = v.goToPage(1); // in flight (filter "{}")
    v.filterText = '{"x":2}';
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const p2 = v.applyFilter();
    resolveOld([{ _id: { $oid: "a" }, x: 1 }]); // stale result resolves after filter change
    await p1;
    await p2;
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, x: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, '{"x":2}', null, null);
  });

  it("goToPage race: stale page result arrives late → discarded, docs reflect the latest page", async () => {
    cnt.mockResolvedValue(200); // pageCount = 4, enough for pages 2 and 3
    qp.mockResolvedValueOnce([]); // init page 1
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();

    // Start goToPage(2) but let queryPage hang
    let resolvePage2!: (val: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolvePage2 = r)));

    const p2 = v.goToPage(2); // in-flight, not yet resolved

    // Immediately call goToPage(3) — resolves right away
    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]);
    await v.goToPage(3); // resolves fast, docs = page 3

    // Now resolve the late page-2 request
    resolvePage2([{ _id: { $oid: "p2" } }]);
    await p2;

    // Page 2 must be discarded; docs still hold page 3 results
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
    expect(v.currentPage).toBe(3);
  });

  it("toggleSort → resets to page 1 and sorts docs", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, age: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, age: 2 }]);
    await v.toggleSort("age", false);
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, age: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null);
  });

  it("setPageSize changes the limit and resets to page 1", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    await v.setPageSize(10);
    expect(v.pageSize).toBe(10);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 10, "{}", null, null);
  });

  it("confirmDelete calls deleteDocument then reloads (count + queryPage)", async () => {
    cnt.mockResolvedValueOnce(1); // init
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    del.mockResolvedValueOnce(undefined);
    cnt.mockResolvedValueOnce(0); // reload count
    qp.mockResolvedValueOnce([]); // reload page
    v.requestDelete(v.docs[0]);
    await v.confirmDelete();
    expect(del).toHaveBeenCalledWith("d", "c", '{"$oid":"a"}');
    expect(v.docs.length).toBe(0);
    expect(v.totalCount).toBe(0);
  });

  it("commitEdit with valid value → calls replaceDocument and updates the cell", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    repl.mockResolvedValueOnce(undefined);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "world";
    await v.commitEdit();
    expect(repl).toHaveBeenCalled();
    expect(v.docs[0].x).toBe("world");
    expect(v.editing).toBeNull();
  });

  it("init calls sampleDocuments and sets schema (columnFields carry type metadata)", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(samp).toHaveBeenCalledWith("d", "c", "{}", 100);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBe("string");
  });

  it("sample error → schema null, columns degrade to row-derived, does not throw", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBeUndefined();
  });

  it("toggleHiddenDraft does NOT call queryPage until applyProjection", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1, secret: 9 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    const callsAfterInit = qp.mock.calls.length;
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    expect(qp.mock.calls.length).toBe(callsAfterInit);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    await v.applyProjection();
    expect(v.hidden.has("secret")).toBe(true);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, "{}", null, '{"secret":0}');
  });

  it("startEdit with an active projection → re-fetches the full doc before editing", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // reload sau applyProjection
    full.mockResolvedValueOnce({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    await v.applyProjection();
    await v.startEdit(0, "x");
    expect(full).toHaveBeenCalledWith("d", "c", '{"$oid":"a"}');
    expect(v.docs[0]).toEqual({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });

  it("startEdit with no projection → does not call fetchFullDoc", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.startEdit(0, "x");
    expect(full).not.toHaveBeenCalled();
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });

});

describe("bulk operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("openBulk sets mode + filter scope and resets", () => {
    const v = createCollectionView("db", "c");
    v.openBulk("delete");
    expect(v.bulkMode).toBe("delete");
    expect(v.bulkScope).toBe("filter");
    expect(v.bulkCount).toBeNull();
  });

  it("countBulk counts with the applied filter", async () => {
    cnt.mockResolvedValueOnce(7);
    const v = createCollectionView("db", "c");
    v.openBulk("delete");
    await v.countBulk();
    expect(countDocuments).toHaveBeenCalledWith("db", "c", "{}");
    expect(v.bulkCount).toBe(7);
  });

  it("runBulk delete with empty filter opens the type-confirm gate (no api call)", async () => {
    const v = createCollectionView("db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.bulkTypeConfirm).toBe(true);
  });

  it("confirmBulkAll runs deleteMany with allowAll=true then reloads", async () => {
    vi.mocked(deleteMany).mockResolvedValueOnce(3);
    cnt.mockResolvedValue(0);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk(); // opens gate
    await v.confirmBulkAll();
    expect(deleteMany).toHaveBeenCalledWith("db", "c", "{}", true);
    expect(v.bulkTypeConfirm).toBe(false);
    expect(v.bulkResult).toContain("3");
    expect(v.bulkCount).toBeNull();
  });

  it("cancelBulkAll closes the gate without running", async () => {
    const v = createCollectionView("db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk();
    v.cancelBulkAll();
    expect(v.bulkTypeConfirm).toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("update-selected: openBulk('update','selection') runs updateMany with $in filter + clears selection", async () => {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(1, { ctrl: true, shift: false });
    v.openBulk("update", "selection");
    expect(v.bulkScope).toBe("selection");
    expect(v.bulkCount).toBe(2);
    v.bulkUpdateText = '{"$set":{"x":1}}';
    vi.mocked(updateMany).mockResolvedValueOnce({ matched: 2, modified: 2 });
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }]);
    await v.runBulk();
    expect(updateMany).toHaveBeenCalledWith(
      "d", "c", '{"_id":{"$in":[{"$oid":"a"},{"$oid":"b"}]}}', '{"$set":{"x":1}}', false,
    );
    expect(v.selectedCount).toBe(0);
  });

  it("update-selected with a bad operator reports an error and does not call updateMany", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.openBulk("update", "selection");
    v.bulkUpdateText = '{"a":1}';
    await v.runBulk();
    expect(updateMany).not.toHaveBeenCalled();
    expect(v.bulkUpdateError).toBeTruthy();
  });

  it("runBulk with a non-empty filter runs directly (no gate)", async () => {
    cnt.mockResolvedValue(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]); // applyFilter reload
    samp.mockResolvedValueOnce([]);
    v.filterText = '{"x":1}';
    await v.applyFilter();
    v.openBulk("delete");
    await v.countBulk();
    vi.mocked(deleteMany).mockResolvedValueOnce(2);
    cnt.mockResolvedValue(0);
    qp.mockResolvedValueOnce([]);
    await v.runBulk();
    expect(v.bulkTypeConfirm).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith("d", "c", '{"x":1}', false);
  });
});

describe("Show ALL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("below threshold → exports immediately, allShown=true", async () => {
    cnt.mockResolvedValueOnce(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(v.docs.length).toBe(3);
    expect(expQ).toHaveBeenCalledWith("d", "c", "{}", null, null);
  });

  it("above threshold → sets showAllPending, does NOT export yet", async () => {
    cnt.mockResolvedValueOnce(6000);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    expect(v.showAllPending).toBe(6000);
    expect(v.allShown).toBe(false);
    expect(expQ).not.toHaveBeenCalled();
  });

  it("confirmShowAll after warning → exports and sets allShown", async () => {
    cnt.mockResolvedValueOnce(6000);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    await v.confirmShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(true);
    expect(expQ).toHaveBeenCalled();
  });

  it("cancelShowAll → clears pending, does not export", async () => {
    cnt.mockResolvedValueOnce(6000);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    v.cancelShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(false);
  });

  it("navigating a page after Show ALL → allShown resets to false", async () => {
    cnt.mockResolvedValueOnce(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    expect(v.allShown).toBe(true);
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([]);
    await v.goToPage(1);
    expect(v.allShown).toBe(false);
  });

  it("requestShowAll race: second call wins, first is discarded by stale-guard", async () => {
    // Call 1: count hangs (would be above threshold if not guarded → 6000)
    let resolveCount1!: (n: number) => void;
    cnt.mockImplementationOnce(() => new Promise<number>((r) => (resolveCount1 = r)));

    const v = createCollectionView("d", "c");
    const p1 = v.requestShowAll(); // in-flight, count not yet resolved

    // Call 2: count below threshold (3) → exports immediately, allShown = true
    cnt.mockResolvedValueOnce(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    await v.requestShowAll();

    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(expQ).toHaveBeenCalledTimes(1);

    // Resolve the late count from call 1 with an above-threshold value
    // Without the stale-guard, call 1 would overwrite showAllPending = 6000
    resolveCount1(6000);
    await p1;

    // Stale-guard must block: state must remain clean
    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(expQ).toHaveBeenCalledTimes(1); // expQ called exactly once (call 2)
  });
});

describe("command log instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
    commandLog.clear();
  });

  it("loading a page pushes findCmd to the command log", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(commandLog.entries.some((e) => e.text === findCmd({ coll: "c", filter: "{}", projection: null, sort: null, limit: 50 }))).toBe(true);
  });

  it("confirmDelete pushes deleteOneCmd to the command log", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    del.mockResolvedValueOnce(undefined);
    cnt.mockResolvedValueOnce(0);
    qp.mockResolvedValueOnce([]);
    commandLog.clear();
    v.requestDelete(v.docs[0]);
    await v.confirmDelete();
    expect(commandLog.entries.some((e) => e.text === deleteOneCmd("c", '{"$oid":"a"}'))).toBe(true);
  });
});

describe("row selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  async function withThreeDocs() {
    cnt.mockResolvedValueOnce(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    return v;
  }

  it("plain click selects only that row", async () => {
    const v = await withThreeDocs();
    v.clickRow(2, { ctrl: false, shift: false });
    expect([...v.selected]).toEqual([2]);
    expect(v.selectedCount).toBe(1);
  });

  it("ctrl-click toggles rows", async () => {
    const v = await withThreeDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(2, { ctrl: true, shift: false });
    expect([...v.selected].sort()).toEqual([0, 2]);
    v.clickRow(0, { ctrl: true, shift: false });
    expect([...v.selected]).toEqual([2]);
  });

  it("shift-click selects the inclusive range from anchor", async () => {
    const v = await withThreeDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(2, { ctrl: false, shift: true });
    expect([...v.selected]).toEqual([0, 1, 2]);
  });

  it("selectAll selects every row; clearSelection empties it", async () => {
    const v = await withThreeDocs();
    v.selectAll();
    expect(v.selectedCount).toBe(3);
    v.clearSelection();
    expect(v.selectedCount).toBe(0);
  });

  it("selection clears after goToPage", async () => {
    const v = await withThreeDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    await v.goToPage(1);
    expect(v.selectedCount).toBe(0);
  });

  it("selection clears after applyFilter", async () => {
    const v = await withThreeDocs();
    v.clickRow(1, { ctrl: false, shift: false });
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" } }]);
    samp.mockResolvedValueOnce([]);
    v.filterText = '{"x":1}';
    await v.applyFilter();
    expect(v.selectedCount).toBe(0);
  });

  it("selectedIds returns id ExtJSON when all rows have _id", async () => {
    const v = await withThreeDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(2, { ctrl: true, shift: false });
    expect(v.selectedIds()).toEqual({ ids: ['{"$oid":"a"}', '{"$oid":"c"}'] });
  });

  it("selectedIds reports missing when a selected row lacks _id", async () => {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.selectAll();
    expect(v.selectedIds()).toEqual({ missing: true });
  });
});

describe("delete selected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("requestDeleteSelected sets pending count; confirm calls deleteMany with $in filter then reloads + clears", async () => {
    cnt.mockResolvedValueOnce(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(2, { ctrl: true, shift: false });
    v.requestDeleteSelected();
    expect(v.confirmSelectionDelete).toBe(2);

    vi.mocked(deleteMany).mockResolvedValueOnce(2);
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" } }]);
    await v.confirmDeleteSelected();

    expect(deleteMany).toHaveBeenCalledWith("d", "c", '{"_id":{"$in":[{"$oid":"a"},{"$oid":"c"}]}}', false);
    expect(v.confirmSelectionDelete).toBeNull();
    expect(v.selectedCount).toBe(0);
  });

  it("confirmDeleteSelected blocks when a selected row lacks _id", async () => {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.selectAll();
    v.requestDeleteSelected();
    await v.confirmDeleteSelected();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.error).toBeTruthy();
  });

  it("requestDeleteSelected does nothing with an empty selection", async () => {
    const v = createCollectionView("d", "c");
    v.requestDeleteSelected();
    expect(v.confirmSelectionDelete).toBeNull();
  });
});

describe("createCollectionView — sort dropdown + field show/hide-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("addSort → adds an asc key, resets to page 1, reloads with sort", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, age: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, age: 2 }]);
    await v.addSort("age");
    expect(v.sortKeys).toEqual([{ path: "age", dir: 1 }]);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null);
  });

  it("toggleSortDirAt → reverses the direction of an existing sort key", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.addSort("age");
    await v.toggleSortDirAt("age");
    expect(v.sortKeys).toEqual([{ path: "age", dir: -1 }]);
  });

  it("moveSort reorders priority; removeSort drops a key; clearSort removes all", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.addSort("a");
    await v.addSort("b");
    await v.moveSort("b", -1);
    expect(v.sortKeys.map((k) => k.path)).toEqual(["b", "a"]);
    await v.removeSort("a");
    expect(v.sortKeys.map((k) => k.path)).toEqual(["b"]);
    await v.clearSort();
    expect(v.sortKeys).toEqual([]);
  });

  it("hideAllFieldsDraft hides all fields except _id; showAllFieldsDraft clears all", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1, y: 2 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.hideAllFieldsDraft();
    expect(v.hiddenDraft.has("_id")).toBe(false);
    expect(v.hiddenDraft.has("x")).toBe(true);
    expect(v.hiddenDraft.has("y")).toBe(true);
    v.showAllFieldsDraft();
    expect(v.hiddenDraft.size).toBe(0);
  });
});

describe("selection-aware context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  async function withTwoDocs() {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }, { _id: { $oid: "b" }, x: 2 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    return v;
  }

  const ev = () =>
    ({ clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} }) as unknown as MouseEvent;

  it("right-click selects the row when it is not already selected", async () => {
    const v = await withTwoDocs();
    v.openMenu(ev(), 1, "x");
    expect([...v.selected]).toEqual([1]);
  });

  it("right-click keeps the existing multi-selection when the row is in it", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    expect(v.selectedCount).toBe(2);
  });

  it("menuItems shows update/delete selected with effective count, no open when n>1", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    const items = v.menuItems();
    const actions = items.map((i) => i.action);
    expect(actions).toContain("updateSelected");
    expect(actions).toContain("deleteSelected");
    const updateItem = items.find((i) => i.action === "updateSelected")!;
    expect(updateItem.label).toContain("2");
    expect(actions).not.toContain("open"); // 2 rows selected → no single-open
  });

  it("onMenuSelect deleteSelected opens the delete-confirm", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    v.onMenuSelect("deleteSelected");
    expect(v.confirmSelectionDelete).toBe(2);
  });

  it("onMenuSelect updateSelected opens the bulk dialog in selection scope", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    v.onMenuSelect("updateSelected");
    expect(v.bulkMode).toBe("update");
    expect(v.bulkScope).toBe("selection");
    expect(v.bulkCount).toBe(2);
  });

  it("menuItems shows Copy and Export submenus with effective count", async () => {
    // open menu on row 0 with no multi-selection → effective count 1
    const v = await withTwoDocs();
    v.openMenu(ev(), 0, "name");
    const items = v.menuItems();
    const copy = items.find((i) => i.label === "Copy");
    const exp = items.find((i) => i.label === "Export");
    expect(copy?.children?.some((c) => c.action === "copyJson")).toBe(true);
    expect(exp?.children?.some((c) => c.action === "exportSelected")).toBe(true);
  });
});

describe("createCollectionView — column widths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("computes a width for every column on init", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alice" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(Object.keys(v.colWidths).sort()).toEqual(["_id", "name"]);
    expect(v.colWidths.name).toBeGreaterThanOrEqual(48);
  });

  it("setColWidth clamps; resetColWidth restores the default", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alice" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    const def = v.colWidths.name;
    v.setColWidth("name", 9999);
    expect(v.colWidths.name).toBe(480);
    v.setColWidth("name", 1);
    expect(v.colWidths.name).toBe(48);
    v.resetColWidth("name");
    expect(v.colWidths.name).toBe(def);
  });

  it("page change does not recompute widths (same column set → manual width preserved)", async () => {
    cnt.mockResolvedValue(200);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alice" }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    v.setColWidth("name", 300);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, name: "Bob" }]);
    await v.goToPage(2);
    expect(v.colWidths.name).toBe(300);
  });
});

describe("effective selection + export request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  const ev = () =>
    ({ clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} }) as unknown as MouseEvent;

  async function withTwoDocs() {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }, { _id: { $oid: "b" }, x: 2 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    return v;
  }

  it("runExport selection → exportQuery called with _id $in filter, json content written", async () => {
    const v = await withTwoDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    v.openMenu(ev(), 0, "x");
    saveDlg.mockResolvedValueOnce("/tmp/c.json");
    exportQueryMock.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    writeF.mockResolvedValueOnce(undefined);
    v.requestExport("selection");
    await v.runExport("json");
    expect(exportQueryMock).toHaveBeenCalledWith(expect.any(String), expect.any(String),
      expect.stringContaining('"$in"'), null, null);
    expect(writeF).toHaveBeenCalled();
  });

  it("runExport filter bson → exportBson called", async () => {
    const v = await withTwoDocs();
    saveDlg.mockResolvedValueOnce("/tmp/c.bson");
    exportBsonMock.mockResolvedValueOnce(2);
    v.requestExport("filter");
    await v.runExport("bson");
    expect(exportBsonMock).toHaveBeenCalled();
  });
});
