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
  updateOne: vi.fn(),
  deleteMany: vi.fn(),
  exportQueryProgress: vi.fn(),
}));

vi.mock("../api/files", () => ({
  openDialog: vi.fn(),
  openDirDialog: vi.fn(),
}));

import * as documents from "../api/documents";
import { createCollectionView } from "./collectionView.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import { findCmd, deleteOneCmd, sampleCmd, findOneByIdCmd } from "../domain/mongosh";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const del = documents.deleteDocument as ReturnType<typeof vi.fn>;
const repl = documents.replaceDocument as ReturnType<typeof vi.fn>;
const upd = documents.updateOne as ReturnType<typeof vi.fn>;
const samp = documents.sampleDocuments as ReturnType<typeof vi.fn>;
const full = documents.fetchFullDoc as ReturnType<typeof vi.fn>;
const expQ = documents.exportQueryProgress as ReturnType<typeof vi.fn>;
const cnt = documents.countDocuments as ReturnType<typeof vi.fn>;

describe("createCollectionView — paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("init: counts total, loads page 1 (skip 0), and derives columns", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(v.docs.length).toBe(1);
    expect(v.totalCount).toBe(1);
    expect(v.currentPage).toBe(1);
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(qp).toHaveBeenCalledWith("conn:1", "d", "c", 0, 50, "{}", null, null);
  });

  it("goToPage(3) calls queryPage with the correct skip and replaces docs", async () => {
    cnt.mockResolvedValue(200); // pageCount = 4
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]); // init trang 1
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]);
    await v.goToPage(3);
    expect(v.currentPage).toBe(3);
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 100, 50, "{}", null, null);
  });

  it("goToPage past pageCount → clamps to the last page", async () => {
    cnt.mockResolvedValue(100); // pageCount = 2
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.goToPage(99);
    expect(v.currentPage).toBe(2);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 50, 50, "{}", null, null);
  });

  it("nextPage/prevPage navigate between pages", async () => {
    cnt.mockResolvedValue(200);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(v.error).toBe("Query: boom");
  });

  it("applyFilter with invalid syntax → sets filterError, does not call queryPage", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    v.filterText = "{bad";
    await v.applyFilter();
    expect(v.filterError).not.toBeNull();
    expect(qp).not.toHaveBeenCalled();
  });

  it("applyFilter with valid input → resets to page 1 and queries with the new filter", async () => {
    cnt.mockResolvedValue(5);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValue([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    v.filterText = '{"x":2}';
    await v.applyFilter();
    expect(v.filterError).toBeNull();
    expect(v.currentPage).toBe(1);
    expect(v.docs.length).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, '{"x":2}', null, null);
    expect(samp).toHaveBeenLastCalledWith("conn:1", "d", "c", '{"x":2}', 100);
  });

  it("applyFilter while a page is loading → discards the stale result and uses the new filter", async () => {
    cnt.mockResolvedValue(5);
    let resolveOld!: (v: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    samp.mockResolvedValue([]);
    const v = createCollectionView("conn:1", "d", "c");
    const p1 = v.goToPage(1); // in flight (filter "{}")
    v.filterText = '{"x":2}';
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const p2 = v.applyFilter();
    resolveOld([{ _id: { $oid: "a" }, x: 1 }]); // stale result resolves after filter change
    await p1;
    await p2;
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, x: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, '{"x":2}', null, null);
  });

  it("goToPage race: stale page result arrives late → discarded, docs reflect the latest page", async () => {
    cnt.mockResolvedValue(200); // pageCount = 4, enough for pages 2 and 3
    qp.mockResolvedValueOnce([]); // init page 1
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, age: 2 }]);
    await v.toggleSort("age", false);
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, age: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null);
  });

  it("setPageSize changes the limit and resets to page 1", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    await v.setPageSize(10);
    expect(v.pageSize).toBe(10);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 10, "{}", null, null);
  });

  it("confirmDelete calls deleteDocument then reloads (count + queryPage)", async () => {
    cnt.mockResolvedValueOnce(1); // init
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    del.mockResolvedValueOnce(undefined);
    cnt.mockResolvedValueOnce(0); // reload count
    qp.mockResolvedValueOnce([]); // reload page
    v.requestDelete(v.docs[0]);
    await v.confirmDelete();
    expect(del).toHaveBeenCalledWith("conn:1", "d", "c", '{"$oid":"a"}');
    expect(v.docs.length).toBe(0);
    expect(v.totalCount).toBe(0);
  });

  it("commitEdit with valid value → calls updateOne with a minimal $set (not replaceDocument)", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "world";
    await v.commitEdit();
    // Full-document replace would re-send every other field too — a $set only sends the
    // touched path, so a huge sibling field never has to round-trip for a one-cell edit.
    expect(upd).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id": {"$oid":"a"}}', '{"$set":{"x":"world"}}', false);
    expect(repl).not.toHaveBeenCalled();
    expect(v.docs[0].x).toBe("world");
    expect(v.editing).toBeNull();
  });

  it("commitEdit never sends a huge untouched sibling field (bug #7 regression)", async () => {
    // Reproduces the reported scenario: a doc with a ~16MB sibling field. Editing an unrelated
    // small field must not JSON.stringify or transmit that sibling — a full replaceDocument
    // round-trip of a 16MB doc for a one-cell edit is what caused the reported UI lag.
    const heavy = "x".repeat(16 * 1024 * 1024);
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "old", value: heavy }]);
    samp.mockResolvedValueOnce([]);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "name");
    v.editText = "new";
    await v.commitEdit();
    expect(upd).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id": {"$oid":"a"}}', '{"$set":{"name":"new"}}', false);
    expect(repl).not.toHaveBeenCalled();
    expect((v.docs[0] as any).value).toBe(heavy); // untouched sibling survives locally, unsent
  });

  it("commitEdit on a nested field sets the nested path via $set without disturbing siblings", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, address: { city: "Hue", zip: "1000" } }]);
    samp.mockResolvedValueOnce([]);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "address.city");
    v.editText = "Hanoi";
    await v.commitEdit();
    expect(upd).toHaveBeenCalledWith(
      "conn:1", "d", "c", '{"_id": {"$oid":"a"}}', '{"$set":{"address.city":"Hanoi"}}', false,
    );
    expect(repl).not.toHaveBeenCalled();
    expect((v.docs[0] as any).address).toEqual({ city: "Hanoi", zip: "1000" });
    expect(v.editing).toBeNull();
  });

  it("onEditBlur with unchanged text cancels silently (no confirm dialog)", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.onEditBlur();
    expect(v.editBlurPending).toBe(false);
    expect(v.editing).toBeNull();
    expect(upd).not.toHaveBeenCalled();
  });

  it("onEditBlur with changed text requests confirmation instead of saving immediately", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "world";
    v.onEditBlur();
    expect(v.editBlurPending).toBe(true);
    expect(v.editing).not.toBeNull();
    expect(upd).not.toHaveBeenCalled();
  });

  it("confirmBlurEdit saves the pending change", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "world";
    v.onEditBlur();
    await v.confirmBlurEdit();
    expect(upd).toHaveBeenCalled();
    expect(v.docs[0].x).toBe("world");
    expect(v.editBlurPending).toBe(false);
    expect(v.editing).toBeNull();
  });

  it("discardBlurEdit discards the pending change", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "world";
    v.onEditBlur();
    v.discardBlurEdit();
    expect(upd).not.toHaveBeenCalled();
    expect(v.docs[0].x).toBe("hello");
    expect(v.editBlurPending).toBe(false);
    expect(v.editing).toBeNull();
  });

  it("init calls sampleDocuments and sets schema (columnFields carry type metadata)", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(samp).toHaveBeenCalledWith("conn:1", "d", "c", "{}", 100);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBe("string");
  });

  it("sample error → schema null, columns degrade to row-derived, does not throw", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBeUndefined();
  });

  it("toggleHiddenDraft does NOT call queryPage until applyProjection", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1, secret: 9 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    const callsAfterInit = qp.mock.calls.length;
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    expect(qp.mock.calls.length).toBe(callsAfterInit);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    await v.applyProjection();
    expect(v.hidden.has("secret")).toBe(true);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", null, '{"secret":0}');
  });

  it("startEdit with an active projection → re-fetches the full doc before editing", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // reload sau applyProjection
    full.mockResolvedValueOnce({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    await v.applyProjection();
    await v.startEdit(0, "x");
    expect(full).toHaveBeenCalledWith("conn:1", "d", "c", '{"$oid":"a"}');
    expect(v.docs[0]).toEqual({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });

  it("startEdit with no projection → does not call fetchFullDoc", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    expect(v.bulkMode).toBe("delete");
    expect(v.bulkScope).toBe("filter");
    expect(v.bulkCount).toBeNull();
  });

  it("countBulk counts with the applied filter", async () => {
    cnt.mockResolvedValueOnce(7);
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    await v.countBulk();
    expect(countDocuments).toHaveBeenCalledWith("conn:1", "db", "c", "{}");
    expect(v.bulkCount).toBe(7);
  });

  it("runBulk delete with empty filter opens the type-confirm gate (no api call)", async () => {
    const v = createCollectionView("conn:1", "db", "c");
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
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk(); // opens gate
    await v.confirmBulkAll();
    expect(deleteMany).toHaveBeenCalledWith("conn:1", "db", "c", "{}", true);
    expect(v.bulkTypeConfirm).toBe(false);
    expect(v.bulkResult).toContain("3");
    expect(v.bulkCount).toBeNull();
  });

  it("cancelBulkAll closes the gate without running", async () => {
    const v = createCollectionView("conn:1", "db", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
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
      "conn:1", "d", "c", '{"_id":{"$in":[{"$oid":"a"},{"$oid":"b"}]}}', '{"$set":{"x":1}}', false,
    );
    expect(v.selectedCount).toBe(0);
  });

  it("update-selected with a bad operator reports an error and does not call updateMany", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.openBulk("update", "selection");
    v.bulkUpdateText = '{"a":1}';
    await v.runBulk();
    expect(updateMany).not.toHaveBeenCalled();
    expect(v.bulkUpdateError).toBeTruthy();
  });

  it("countBulk reports busy while counting is in flight", async () => {
    let sawBusy = false;
    cnt.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
      return 7;
    });
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    await v.countBulk();
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });

  it("runBulk with a non-empty filter runs directly (no gate)", async () => {
    cnt.mockResolvedValue(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    expect(deleteMany).toHaveBeenCalledWith("conn:1", "d", "c", '{"x":1}', false);
  });

  it("countBulk pushes countCmd to the command log with a measured duration", async () => {
    cnt.mockResolvedValueOnce(7);
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    commandLog.clear();
    await v.countBulk();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Show ALL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  /** requestShowAll gates off the already-known totalCount (set by init/refreshCount), so tests
   *  seed it via a real init() instead of feeding requestShowAll its own count mock. */
  async function withTotal(n: number) {
    cnt.mockResolvedValueOnce(n);
    qp.mockResolvedValueOnce([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    return v;
  }

  it("below threshold → exports immediately, allShown=true", async () => {
    const v = await withTotal(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    await v.requestShowAll();
    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(v.docs.length).toBe(3);
    expect(expQ).toHaveBeenCalledWith("conn:1", "d", "c", "{}", null, null, expect.any(Function));
    expect(cnt).toHaveBeenCalledTimes(1); // only init's count — no extra re-count round-trip
  });

  it("above threshold → sets showAllPending, does NOT export yet", async () => {
    const v = await withTotal(6000);
    await v.requestShowAll();
    expect(v.showAllPending).toBe(6000);
    expect(v.allShown).toBe(false);
    expect(expQ).not.toHaveBeenCalled();
    expect(cnt).toHaveBeenCalledTimes(1); // only init's count — no extra re-count round-trip
  });

  it("confirmShowAll after warning → exports and sets allShown", async () => {
    const v = await withTotal(6000);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    await v.requestShowAll();
    await v.confirmShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(true);
    expect(expQ).toHaveBeenCalled();
  });

  it("cancelShowAll → clears pending, does not export", async () => {
    const v = await withTotal(6000);
    await v.requestShowAll();
    v.cancelShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(false);
  });

  it("navigating a page after Show ALL → allShown resets to false", async () => {
    const v = await withTotal(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    await v.requestShowAll();
    expect(v.allShown).toBe(true);
    cnt.mockResolvedValue(3);
    qp.mockResolvedValueOnce([]);
    await v.goToPage(1);
    expect(v.allShown).toBe(false);
  });

  it("confirmShowAll race: second call wins, first is discarded by stale-guard", async () => {
    const v = await withTotal(3);

    // Call 1: export hangs
    let resolveExport1!: (docs: unknown[]) => void;
    expQ.mockImplementationOnce(() => new Promise((r) => (resolveExport1 = r)));
    const p1 = v.confirmShowAll(); // in-flight, export not yet resolved

    // Call 2: export resolves fast
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    await v.confirmShowAll();

    expect(v.allShown).toBe(true);
    expect(v.docs.length).toBe(3);
    expect(expQ).toHaveBeenCalledTimes(2);

    // Resolve the late export from call 1 — without the stale-guard this would overwrite
    // the state that call 2 already committed.
    resolveExport1([{ _id: { $oid: "stale" } }]);
    await p1;

    // Stale-guard must block: state must remain from call 2
    expect(v.docs.length).toBe(3);
  });
});

describe("command log instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
    commandLog.clear();
  });

  it("loading a page pushes findCmd to the command log with a measured duration", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    const entry = commandLog.entries.find(
      (e) => e.text === findCmd({ coll: "c", filter: "{}", projection: null, sort: null, limit: 50 }),
    );
    expect(entry).toBeDefined();
    expect(entry!.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("confirmDelete pushes deleteOneCmd to the command log with a measured duration", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    del.mockResolvedValueOnce(undefined);
    cnt.mockResolvedValueOnce(0);
    qp.mockResolvedValueOnce([]);
    commandLog.clear();
    v.requestDelete(v.docs[0]);
    await v.confirmDelete();
    const entry = commandLog.entries.find((e) => e.text === deleteOneCmd("c", '{"$oid":"a"}'));
    expect(entry).toBeDefined();
    expect(entry!.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("loadSchema pushes sampleCmd to the command log with a measured duration", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    const entry = commandLog.entries.find((e) => e.text === sampleCmd("c", 100));
    expect(entry).toBeDefined();
    expect(entry!.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("startEdit with an active projection pushes findOneByIdCmd to the command log", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    full.mockResolvedValueOnce({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    await v.applyProjection();
    commandLog.clear();
    await v.startEdit(0, "x");
    expect(commandLog.entries.some((e) => e.text === findOneByIdCmd("c", '{"$oid":"a"}'))).toBe(true);
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
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(2, { ctrl: true, shift: false });
    v.requestDeleteSelected();
    expect(v.confirmSelectionDelete).toBe(2);

    vi.mocked(deleteMany).mockResolvedValueOnce(2);
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" } }]);
    await v.confirmDeleteSelected();

    expect(deleteMany).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id":{"$in":[{"$oid":"a"},{"$oid":"c"}]}}', false);
    expect(v.confirmSelectionDelete).toBeNull();
    expect(v.selectedCount).toBe(0);
  });

  it("confirmDeleteSelected blocks when a selected row lacks _id", async () => {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.selectAll();
    v.requestDeleteSelected();
    await v.confirmDeleteSelected();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.error).toBeTruthy();
  });

  it("requestDeleteSelected does nothing with an empty selection", async () => {
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, age: 2 }]);
    await v.addSort("age");
    expect(v.sortKeys).toEqual([{ path: "age", dir: 1 }]);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null);
  });

  it("toggleSortDirAt → reverses the direction of an existing sort key", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.addSort("age");
    await v.toggleSortDirAt("age");
    expect(v.sortKeys).toEqual([{ path: "age", dir: -1 }]);
  });

  it("moveSort reorders priority; removeSort drops a key; clearSort removes all", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
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

  it("menuItems groups update/delete into submenus with effective count, no open when n>1", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    const items = v.menuItems();
    const actions = items.map((i) => i.action);
    expect(actions).not.toContain("open"); // 2 rows selected → no single-open
    const update = items.find((i) => i.label === "Update");
    const del = items.find((i) => i.label === "Delete");
    expect(update?.children?.some((c) => c.action === "updateSelected")).toBe(true);
    expect(update?.children?.some((c) => c.action === "updateAll")).toBe(true);
    expect(del?.children?.some((c) => c.action === "deleteSelected")).toBe(true);
    expect(del?.children?.some((c) => c.action === "deleteAll")).toBe(true);
    // effective count shown on the "selected" children
    const updSel = update?.children?.find((c) => c.action === "updateSelected")!;
    expect(updSel.label).toContain("2");
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

  it("onMenuSelect copyValue copies the plain display value, not raw ExtJSON", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, writable: true });
    const v = await withTwoDocs();
    v.openMenu(ev(), 0, "_id");
    v.onMenuSelect("copyValue");
    expect(writeText).toHaveBeenCalledWith("a"); // not {"$oid":"a"}
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(Object.keys(v.colWidths).sort()).toEqual(["_id", "name"]);
    expect(v.colWidths.name).toBeGreaterThanOrEqual(48);
  });

  it("setColWidth clamps; resetColWidth restores the default", async () => {
    cnt.mockResolvedValue(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alice" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
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
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    return v;
  }

  it("exportInput selection → scopedCollection with _id $in filter", async () => {
    const v = await withTwoDocs();
    v.clickRow(0, { ctrl: false, shift: false });
    v.openMenu(ev(), 0, "x");
    v.requestExport("selection");
    const input = v.exportInput();
    expect(input?.mode).toBe("scopedCollection");
    expect(input).not.toBeNull();
    if (input && input.mode === "scopedCollection") {
      expect(input.filter).toContain('"$in"');
      expect(input.db).toBe("d");
      expect(input.coll).toBe("c");
    }
  });
});
