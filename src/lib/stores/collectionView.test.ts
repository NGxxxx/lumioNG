import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("../api/indexes", () => ({
  listIndexes: vi.fn().mockResolvedValue(['{"v":2,"key":{"_id":1},"name":"_id_"}', '{"v":2,"key":{"status":1},"name":"status_1"}']),
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
import { settings } from "./settings.svelte";
import { pendingEdits } from "./pendingEdits.svelte";
import { viewPresets } from "./viewPresets.svelte";
import { pendingKey } from "../domain/pendingEdits";
import { setSessionEnvironment } from "./sessionEnv";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const del = documents.deleteDocument as ReturnType<typeof vi.fn>;
const repl = documents.replaceDocument as ReturnType<typeof vi.fn>;
const upd = documents.updateOne as ReturnType<typeof vi.fn>;
const samp = documents.sampleDocuments as ReturnType<typeof vi.fn>;
const full = documents.fetchFullDoc as ReturnType<typeof vi.fn>;
const expQ = documents.exportQueryProgress as ReturnType<typeof vi.fn>;
const cnt = documents.countDocuments as ReturnType<typeof vi.fn>;

// Layouts are remembered per namespace in local storage; most tests share "conn:1/d/c".
beforeEach(() => localStorage.clear());

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
    expect(qp).toHaveBeenCalledWith("conn:1", "d", "c", 0, 50, "{}", null, null, 30000);
  });

  it("init: page 1 rows arrive without waiting for a slow count", async () => {
    let resolveCount!: (n: number) => void;
    cnt.mockReturnValueOnce(new Promise<number>((res) => { resolveCount = res; }));
    samp.mockResolvedValueOnce([]);
    qp.mockResolvedValueOnce([{ _id: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    const initP = v.init();
    await vi.waitFor(() => expect(v.docs).toEqual([{ _id: 1 }]));
    expect(v.totalCount).toBe(0);
    resolveCount(1);
    await initP;
    expect(v.totalCount).toBe(1);
  });

  it("records how long the last page query took", async () => {
    samp.mockResolvedValueOnce([]);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    expect(v.lastQueryMs).toBeNull();
    await v.init();
    expect(v.lastQueryMs).toBeGreaterThanOrEqual(0);
  });

  it("init: loading is true immediately, before the count/schema calls resolve", async () => {
    let resolveCount!: (n: number) => void;
    cnt.mockReturnValueOnce(new Promise<number>((res) => { resolveCount = res; }));
    samp.mockResolvedValueOnce([]);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    const initP = v.init();
    expect(v.loading).toBe(true);
    resolveCount(0);
    await initP;
    expect(v.loading).toBe(false);
  });

  it("init: activity.busy is true while refreshCount's countDocuments is in flight (Stop button gate)", async () => {
    let sawBusy = false;
    cnt.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
      return 0;
    });
    samp.mockResolvedValueOnce([]);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });

  it("init: activity.busy is true while loadSchema's sampleDocuments is in flight (Stop button gate)", async () => {
    let sawBusy = false;
    samp.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
      return [];
    });
    cnt.mockResolvedValueOnce(0);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 100, 50, "{}", null, null, 30000);
  });

  it("goToPage past pageCount → clamps to the last page", async () => {
    cnt.mockResolvedValue(100); // pageCount = 2
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.goToPage(99);
    expect(v.currentPage).toBe(2);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 50, 50, "{}", null, null, 30000);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, '{"x":2}', null, null, 30000);
    expect(samp).toHaveBeenLastCalledWith("conn:1", "d", "c", '{"x":2}', 100, 30000);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, '{"x":2}', null, null, 30000);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null, 30000);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 10, "{}", null, null, 30000);
  });

  it("confirming a single delete calls deleteDocument then reloads (count + queryPage)", async () => {
    cnt.mockResolvedValueOnce(1); // init
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]); // init
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    del.mockResolvedValueOnce(undefined);
    cnt.mockResolvedValueOnce(0); // reload count
    qp.mockResolvedValueOnce([]); // reload page
    v.requestDelete(v.docs[0]);
    await v.destructive.confirm();
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
    expect(samp).toHaveBeenCalledWith("conn:1", "d", "c", "{}", 100, 30000);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", null, '{"secret":0}', 30000);
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
    expect(v.editing).toEqual({ row: 0, key: "x", kind: "inline" });
  });

  it("startEdit with no projection → does not call fetchFullDoc", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    expect(full).not.toHaveBeenCalled();
    expect(v.editing).toEqual({ row: 0, key: "x", kind: "inline" });
  });

  it("startEdit on an object/array field opens the modal editor with pretty-printed JSON", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, tags: ["a", "b"] }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "tags");
    expect(v.editing).toEqual({ row: 0, key: "tags", kind: "modal" });
    // Text is seeded a tick later (see startEdit) so the modal shell can paint first.
    expect(v.editTextLoading).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(v.editTextLoading).toBe(false);
    expect(v.editText).toBe(JSON.stringify(["a", "b"], null, 2));
  });

  it("commitEdit on a modal edit parses the JSON and $sets the field", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, tags: ["a"] }]);
    samp.mockResolvedValueOnce([]);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "tags");
    v.editText = '["a","b","c"]';
    await v.commitEdit();
    expect(upd).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id": {"$oid":"a"}}', '{"$set":{"tags":["a","b","c"]}}', false);
    expect(v.docs[0]).toEqual({ _id: { $oid: "a" }, tags: ["a", "b", "c"] });
    expect(v.editing).toBeNull();
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
    expect(countDocuments).toHaveBeenCalledWith("conn:1", "db", "c", "{}", 30000);
    expect(v.bulkCount).toBe(7);
  });

  it("runBulk delete with empty filter opens the type-confirm gate (no api call)", async () => {
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.destructive.pending?.level).toBe("type");
  });

  it("confirming the type gate runs deleteMany with allowAll=true then reloads", async () => {
    vi.mocked(deleteMany).mockResolvedValueOnce(3);
    cnt.mockResolvedValue(0);
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk(); // opens gate
    await v.destructive.confirm();
    expect(deleteMany).toHaveBeenCalledWith("conn:1", "db", "c", "{}", true);
    expect(v.destructive.pending).toBeNull();
    expect(v.bulkResult).toContain("3");
    expect(v.bulkCount).toBeNull();
  });

  it("cancelling the type gate closes the gate without running", async () => {
    const v = createCollectionView("conn:1", "db", "c");
    v.openBulk("delete");
    cnt.mockResolvedValueOnce(3);
    await v.countBulk();
    await v.runBulk();
    v.destructive.cancel();
    expect(v.destructive.pending).toBeNull();
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
    expect(v.destructive.pending).toBeNull();
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

  it("a confirmed single delete pushes deleteOneCmd to the command log with a measured duration", async () => {
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
    await v.destructive.confirm();
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
    expect(v.destructive.pending?.count).toBe(2);

    vi.mocked(deleteMany).mockResolvedValueOnce(2);
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" } }]);
    await v.destructive.confirm();

    expect(deleteMany).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id":{"$in":[{"$oid":"a"},{"$oid":"c"}]}}', false);
    expect(v.destructive.pending).toBeNull();
    expect(v.selectedCount).toBe(0);
  });

  it("a confirmed selection delete blocks when a selected row lacks _id", async () => {
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.selectAll();
    v.requestDeleteSelected();
    await v.destructive.confirm();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.error).toBeTruthy();
  });

  it("requestDeleteSelected does nothing with an empty selection", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    v.requestDeleteSelected();
    expect(v.destructive.pending).toBeNull();
  });
});

describe("createCollectionView — environment policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("on a PROD session a selection delete needs the collection name typed", async () => {
    setSessionEnvironment("conn:9", "prod");
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("conn:9", "d", "c");
    await v.init();
    v.selectAll();
    v.requestDeleteSelected();
    expect(v.destructive.pending).toMatchObject({ op: "deleteMany", count: 2, level: "type", undoable: true });
    setSessionEnvironment("conn:9", null);
  });

  it("a non-empty filter bulk delete on DEV runs straight from the bulk dialog", async () => {
    setSessionEnvironment("conn:8", "dev");
    const v = createCollectionView("conn:8", "d", "c");
    v.filterText = '{"x":1}';
    cnt.mockResolvedValue(2);
    qp.mockResolvedValue([]);
    samp.mockResolvedValue([]);
    await v.applyFilter();
    v.openBulk("delete");
    await v.countBulk();
    vi.mocked(deleteMany).mockResolvedValueOnce(2);
    await v.runBulk();
    expect(deleteMany).toHaveBeenCalled();
    expect(v.destructive.pending).toBeNull();
    setSessionEnvironment("conn:8", null);
  });
});

describe("createCollectionView — quick search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alpha" }, { _id: { $oid: "b" }, name: "Beta" }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alpha" }, { _id: { $oid: "b" }, name: "Beta" }]);
  });
  afterEach(() => vi.useRealTimers());

  it("visibleIndices is null (unfiltered) when searchTerm is empty", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(v.visibleIndices).toBeNull();
  });

  it("visibleIndices narrows to the matching rows for a valid regex, after the debounce", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.searchTerm = "alpha";
    expect(v.visibleIndices).toBeNull(); // not yet applied — still debouncing
    vi.advanceTimersByTime(1000);
    expect(v.visibleIndices).toEqual([0]);
    expect(v.searchInvalid).toBe(false);
  });

  it("searchInvalid is true for an invalid regex immediately (not debounced), and visibleIndices stays null", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.searchTerm = "[unterminated";
    expect(v.searchInvalid).toBe(true);
    expect(v.visibleIndices).toBeNull();
  });

  it("clearing the term back to empty applies immediately, skipping the debounce", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.searchTerm = "alpha";
    vi.advanceTimersByTime(1000);
    expect(v.visibleIndices).toEqual([0]);
    v.searchTerm = "";
    expect(v.visibleIndices).toBeNull();
  });

  it("hiding a column excludes it from the search scope", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    cnt.mockResolvedValueOnce(2);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, name: "Alpha" }, { _id: { $oid: "b" }, name: "Beta" }]);
    v.toggleHiddenDraft("name");
    await v.applyProjection();
    v.searchTerm = "alpha";
    vi.advanceTimersByTime(1000);
    expect(v.visibleIndices).toEqual([]); // "name" is hidden; _id doesn't contain "alpha"
  });
});

describe("createCollectionView — search filter and multi-row selection safety", () => {
  // 5 docs; a search term below excludes only index 2 (id "2" / name "C"), leaving a gap in
  // the visible index space — the exact condition that broke naive shift-range/select-all.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    cnt.mockResolvedValueOnce(5);
    qp.mockResolvedValueOnce([
      { _id: { $oid: "0" }, name: "A" },
      { _id: { $oid: "1" }, name: "B" },
      { _id: { $oid: "2" }, name: "C" },
      { _id: { $oid: "3" }, name: "D" },
      { _id: { $oid: "4" }, name: "E" },
    ]);
    samp.mockResolvedValueOnce([]);
  });
  afterEach(() => vi.useRealTimers());

  it("shift-click range-select never includes a row the active search filter hid", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.searchTerm = "^[^2C]$"; // excludes doc index 2 only
    vi.advanceTimersByTime(1000);
    expect(v.visibleIndices).toEqual([0, 1, 3, 4]);
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(4, { ctrl: false, shift: true });
    expect([...v.selected].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });

  it("selectAll only selects rows the active search filter is showing", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.searchTerm = "^[^2C]$";
    vi.advanceTimersByTime(1000);
    v.selectAll();
    expect([...v.selected].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });

  it("shift-click range-select is unaffected when no search filter is active", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(4, { ctrl: false, shift: true });
    expect([...v.selected].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
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
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, "{}", '{"age":1,"_id":1}', null, 30000);
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
    qp.mockResolvedValueOnce([
      { _id: { $oid: "a" }, x: 1, address: { city: "Hanoi", geo: { lat: 21 } } },
      { _id: { $oid: "b" }, x: 2 },
    ]);
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
    expect(v.destructive.pending?.count).toBe(2);
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

  it("copyValue copies full JSON for container values", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const v = await withTwoDocs();
    v.openMenu(ev(), 0, "address");
    v.onMenuSelect("copyValue");
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ city: "Hanoi", geo: { lat: 21 } }, null, 2));
  });

  it("single-row menu starts with Quick look, which returns a peek request", async () => {
    const v = await withTwoDocs();
    v.openMenu(ev(), 1, "x");
    expect(v.menuItems()[0]).toEqual({ label: "Quick look", action: "peek" });
    expect(v.onMenuSelect("peek")).toEqual({ peek: v.docs[1] });
    expect(v.menu).toBeNull();
  });

  it("replaceDoc swaps the row with the same _id, immutably", async () => {
    const v = await withTwoDocs();
    const before = v.docs;
    v.replaceDoc({ _id: { $oid: "b" }, x: 99 });
    expect(v.docs[1]).toEqual({ _id: { $oid: "b" }, x: 99 });
    expect(v.docs).not.toBe(before);
    v.replaceDoc({ _id: { $oid: "zzz" }, x: 1 }); // not on this page: no change
    expect(v.docs.map((d) => d.x)).toEqual([1, 99]);
  });

  it("requestDeleteDoc targets that document, not the current selection", async () => {
    const v = await withTwoDocs();
    v.clickRow(1, { ctrl: false, shift: false });
    v.requestDeleteDoc(v.docs[0]);
    expect([...v.selected]).toEqual([0]);
    expect(v.destructive.pending).not.toBeNull();
  });

  it("togglePin pins and unpins a column", async () => {
    const v = await withTwoDocs();
    v.togglePin("x");
    expect([...v.pinned]).toEqual(["x"]);
    v.togglePin("x");
    expect(v.pinned.size).toBe(0);
  });

  it("header menu lists sort / hide / pin / autofit / copy path / exists filters", async () => {
    const v = await withTwoDocs();
    expect(v.headerMenuItems("x").map((i) => i.action)).toEqual([
      "sortAsc", "sortDesc", "clearSort", "hide", "pin", "autofit", "copyPath", "exists", "notExists",
    ]);
    v.togglePin("x");
    expect(v.headerMenuItems("x").find((i) => i.action === "pin")?.label).toBe("Unpin column");
  });

  it("header menu sort and hide act on that column", async () => {
    const v = await withTwoDocs();
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    await v.onHeaderMenuSelect("x", "sortDesc");
    expect(v.sortKeys).toEqual([{ path: "x", dir: -1 }]);
    await v.onHeaderMenuSelect("x", "hide");
    expect(v.hidden.has("x")).toBe(true);
  });

  it("filterBy merges a condition into the filter text and re-runs", async () => {
    const v = await withTwoDocs();
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    samp.mockResolvedValue([]);
    v.filterText = '{"x": {"$gt": 0}}';
    await v.applyFilter();
    await v.filterBy("address.city", "eq", "Hanoi");
    expect(JSON.parse(v.filterText)).toEqual({ x: { $gt: 0 }, "address.city": "Hanoi" });
    expect(JSON.parse(v.appliedFilter)).toEqual({ x: { $gt: 0 }, "address.city": "Hanoi" });
  });

  it("filterBy merges into the applied filter, not an unapplied draft", async () => {
    const v = await withTwoDocs();
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    samp.mockResolvedValue([]);
    v.filterText = '{"x": 1}';
    await v.applyFilter();
    v.filterText = '{"draft": true}'; // typed but never run
    await v.filterBy("y", "eq", 2);
    expect(JSON.parse(v.appliedFilter)).toEqual({ x: 1, y: 2 });
  });

  it("filterBy ignores a broken unapplied draft and builds on the applied filter", async () => {
    const v = await withTwoDocs();
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    samp.mockResolvedValue([]);
    v.filterText = "{oops";
    await v.filterBy("x", "eq", 1);
    expect(JSON.parse(v.filterText)).toEqual({ x: 1 });
    expect(v.filterError).toBeNull();
  });

  it("cell menu offers Filter by / Exclude this value", async () => {
    const v = await withTwoDocs();
    qp.mockResolvedValue([]);
    cnt.mockResolvedValue(0);
    samp.mockResolvedValue([]);
    v.openMenu(ev(), 0, "address.city");
    const actions = v.menuItems().map((i) => i.action);
    expect(actions).toContain("filterEq");
    expect(actions).toContain("filterNe");
    v.onMenuSelect("filterNe");
    await vi.waitFor(() => expect(JSON.parse(v.filterText)).toEqual({ "address.city": { $ne: "Hanoi" } }));
  });

  it("menu offers Field path and copyPath copies the key", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const v = await withTwoDocs();
    v.openMenu(ev(), 0, "address.city");
    const copy = v.menuItems().find((i) => i.action === "copy")!;
    expect(copy.children!.some((c) => c.action === "copyPath")).toBe(true);
    v.onMenuSelect("copyPath");
    expect(writeText).toHaveBeenCalledWith("address.city");
  });
});

describe("createCollectionView — grid shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(2);
  });

  it("invertSelection flips selected rows within the currently visible set", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }, { _id: { $oid: "b" }, x: 2 }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.clickRow(0, { ctrl: false, shift: false });
    expect([...v.selected]).toEqual([0]);
    v.invertSelection();
    expect([...v.selected]).toEqual([1]);
    v.invertSelection();
    expect([...v.selected]).toEqual([0]);
  });

  it("newDocument returns a skeleton built from the current columns", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    const doc = v.newDocument();
    expect(Object.keys(doc)).toContain("x");
  });

  it("duplicateSelected returns null unless exactly one row is selected", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }, { _id: { $oid: "b" }, x: 2 }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    expect(v.duplicateSelected()).toBeNull(); // nothing selected
    v.clickRow(0, { ctrl: false, shift: false });
    v.clickRow(1, { ctrl: true, shift: false });
    expect(v.duplicateSelected()).toBeNull(); // two selected
    v.clickRow(0, { ctrl: false, shift: false });
    const dup = v.duplicateSelected();
    expect(dup).not.toBeNull();
    expect(dup!.x).toBe(1);
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

describe("createCollectionView — grid depth limit", () => {
  const nested = { _id: { $oid: "a" }, addr: { city: "HCM", geo: { lat: 1 } } };

  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(1);
    settings.setGridMaxDepth(1);
  });
  afterEach(() => settings.setGridMaxDepth(1));

  it("collapses nested paths at depth 1 and reacts to setting changes without reloading", async () => {
    qp.mockResolvedValueOnce([nested]);
    samp.mockResolvedValueOnce([nested]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();

    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "addr"]);
    expect(v.columnFields.find((c) => c.path === "addr")!.type).toBe("object");

    settings.setGridMaxDepth(2);
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "addr.city", "addr.geo"]);

    settings.setGridMaxDepth(null);
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "addr.city", "addr.geo.lat"]);
  });

  it("exportInput marks raw leaf paths under a hidden prefix column as not visible", async () => {
    qp.mockResolvedValueOnce([nested]);
    samp.mockResolvedValueOnce([nested]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();

    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "addr"]);

    v.toggleHiddenDraft("addr");
    qp.mockResolvedValueOnce([nested]); // reload after applyProjection
    await v.applyProjection();

    v.requestExport("filter");
    const input = v.exportInput();
    expect(input).not.toBeNull();
    if (input && input.mode === "scopedCollection") {
      const byPath = Object.fromEntries(input.columns.map((c) => [c.path, c.visible]));
      expect(byPath["_id"]).toBe(true);
      expect(byPath["addr.city"]).toBe(false);
      expect(byPath["addr.geo.lat"]).toBe(false);
    }
  });

  it("exportInput threads each column's inferred type through for the export nested-field notice", async () => {
    qp.mockResolvedValueOnce([nested]);
    samp.mockResolvedValueOnce([nested]);
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();

    v.requestExport("filter");
    const input = v.exportInput();
    expect(input).not.toBeNull();
    if (input && input.mode === "scopedCollection") {
      const byPath = Object.fromEntries(input.columns.map((c) => [c.path, c.type]));
      expect(byPath["_id"]).toBe("objectId");
      expect(byPath["addr.city"]).toBe("string");
    }
  });

  it("a failed count still allows the bulk run, but only with type-to-confirm", async () => {
    setSessionEnvironment("conn:7", "dev");
    const v = createCollectionView("conn:7", "d", "c");
    v.filterText = '{"x":1}';
    cnt.mockResolvedValue(2);
    qp.mockResolvedValue([]);
    samp.mockResolvedValue([]);
    await v.applyFilter();
    v.openBulk("delete");
    cnt.mockRejectedValueOnce(new Error("timeout"));
    await v.countBulk();
    expect(v.bulkCount).toBeNull();
    expect(v.canRunBulk).toBe(true);
    await v.runBulk();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(v.destructive.pending).toMatchObject({ count: null, level: "type" });
    setSessionEnvironment("conn:7", null);
  });

  it("an invalid update document is reported before any confirmation", async () => {
    setSessionEnvironment("conn:6", "prod");
    const v = createCollectionView("conn:6", "d", "c");
    v.openBulk("update", "filter");
    v.bulkUpdateText = "{oops";
    await v.runBulk();
    expect(v.bulkUpdateError).not.toBeNull();
    expect(v.destructive.pending).toBeNull();
    setSessionEnvironment("conn:6", null);
  });
});

describe("createCollectionView — filter chips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    cnt.mockResolvedValue(2);
    qp.mockResolvedValue([{ _id: 1, status: "shipped", total: 5 }, { _id: 2, status: "pending", total: 7 }]);
    samp.mockResolvedValue([]);
  });

  it("chips mirror the applied filter; setChips applies at once", async () => {
    const v = createCollectionView("conn:1", "shop", "orders");
    await v.init();
    expect(v.chips).toEqual([]);
    await v.setChips([{ field: "status", op: "eq", values: ['"shipped"'] }]);
    expect(JSON.parse(v.appliedFilter)).toEqual({ status: "shipped" });
    expect(v.chips).toEqual([{ field: "status", op: "eq", values: ['"shipped"'] }]);
  });

  it("an advanced filter has no chips", async () => {
    const v = createCollectionView("conn:1", "shop", "orders");
    v.filterText = '{"$expr": {"$gt": ["$a", "$b"]}}';
    await v.applyFilter();
    expect(v.chips).toBeNull();
  });

  it("applied filters go to the history of that collection", async () => {
    const v = createCollectionView("conn:1", "shop", "history_only");
    await v.setChips([{ field: "total", op: "gt", values: ["100"] }]);
    expect(v.filterHistory.map((e) => JSON.parse(e.text))).toEqual([{ total: { $gt: 100 } }]);
  });

  it("knows field types, indexes, sample values, slow-field and zero-result hints", async () => {
    const v = createCollectionView("conn:1", "shop", "orders");
    await v.init();
    await vi.waitFor(() => expect(v.fieldInfos.find((f) => f.path === "status")?.indexed).toBe(true));
    expect(v.valuesFor("status")).toEqual(['"shipped"', '"pending"']);
    expect(v.slowFieldHint("total")).toBe(false); // small collection
    cnt.mockResolvedValue(0);
    qp.mockResolvedValue([]);
    await v.setChips([{ field: "status", op: "eq", values: ['"nope"'] }]);
    expect(v.zeroResult).toBe(true);
  });

  it("cell menu offers 'field exists' and adds it as a chip", async () => {
    const v = createCollectionView("conn:1", "shop", "orders");
    await v.init();
    v.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent, 0, "total");
    expect(v.menuItems().map((i) => i.action)).toContain("filterExists");
    v.onMenuSelect("filterExists");
    await vi.waitFor(() => expect(JSON.parse(v.appliedFilter)).toEqual({ total: { $exists: true } }));
  });

  it("cell menu 'is empty' keeps an applied filter that is not chip-shaped", async () => {
    const v = createCollectionView("conn:1", "shop", "orders");
    await v.init();
    v.filterText = '{"$or": [{"a": 1}, {"b": 2}]}';
    await v.applyFilter();
    expect(v.chips).toBeNull();
    v.openMenu({ preventDefault() {}, stopPropagation() {}, clientX: 1, clientY: 1 } as unknown as MouseEvent, 0, "total");
    v.onMenuSelect("filterEmpty");
    await vi.waitFor(() =>
      expect(JSON.parse(v.appliedFilter)).toEqual({ $and: [{ $or: [{ a: 1 }, { b: 2 }] }, { total: { $in: [null, "", []] } }] }),
    );
  });
});

describe("createCollectionView — remembered layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    cnt.mockResolvedValue(1);
    qp.mockResolvedValue([{ _id: 1, a: 1, b: 2 }]);
    samp.mockResolvedValue([]);
  });

  it("hidden / pinned / widths / sort / mode come back for the same collection", async () => {
    vi.useFakeTimers();
    try {
      const v = createCollectionView("conn:1", "shop", "layout1");
      await v.init();
      v.togglePin("a");
      v.setColWidth("b", 333);
      v.view = "tree";
      await v.onHeaderMenuSelect("b", "sortDesc");
      await v.onHeaderMenuSelect("a", "hide");
      vi.advanceTimersByTime(400);
      const again = createCollectionView("conn:1", "shop", "layout1");
      expect([...again.pinned]).toEqual(["a"]);
      expect([...again.hidden]).toEqual(["a"]);
      expect(again.sortKeys).toEqual([{ path: "b", dir: -1 }]);
      expect(again.view).toBe("tree");
      await again.init();
      expect(again.colWidths.b).toBe(333);
      expect(qp.mock.calls.at(-1)?.[6]).toBe('{"b":-1,"_id":1}');
    } finally {
      vi.useRealTimers();
    }
  });

  it("the filter is not remembered; reset layout restores defaults", async () => {
    vi.useFakeTimers();
    try {
      const v = createCollectionView("conn:1", "shop", "layout2");
      await v.init();
      v.togglePin("a");
      v.filterText = '{"a": 1}';
      await v.applyFilter();
      vi.advanceTimersByTime(400);
      const again = createCollectionView("conn:1", "shop", "layout2");
      expect(again.appliedFilter).toBe("{}");
      await again.resetLayout();
      expect([...again.pinned]).toEqual([]);
      expect(createCollectionView("conn:1", "shop", "layout2").pinned.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("createCollectionView — presetFilter", () => {
  it("a preset filter is what the first load uses (one query, already filtered)", async () => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(1);
    qp.mockResolvedValue([{ _id: 1 }]);
    const v = createCollectionView("conn:1", "shop", "customers");
    v.presetFilter('{"_id": {"$oid": "652f1a9e0000000000000c41"}}');
    await v.init();
    expect(qp).toHaveBeenCalledTimes(1);
    expect(qp.mock.calls[0]).toContain('{"_id": {"$oid": "652f1a9e0000000000000c41"}}');
    expect(v.chips).toEqual([{ field: "_id", op: "eq", values: ['{"$oid": "652f1a9e0000000000000c41"}'] }]);
  });
});

describe("createCollectionView — staged edits (settings.stageCellEdits)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingEdits.dropSession("conn:1");
    cnt.mockResolvedValue(2);
    samp.mockResolvedValue([]);
    settings.setStageCellEdits(true);
  });
  afterEach(() => settings.setStageCellEdits(false));

  const page = () => [{ _id: { $oid: "a" }, x: "old" }, { _id: { $oid: "b" }, x: "keep" }];

  async function stagedView() {
    qp.mockResolvedValueOnce(page());
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    await v.startEdit(0, "x");
    v.editText = "new";
    await v.commitEdit();
    return v;
  }

  it("an edit is shown and marked pending, but nothing is written", async () => {
    const v = await stagedView();
    expect(upd).not.toHaveBeenCalled();
    expect(v.docs[0].x).toBe("new");
    expect(v.editing).toBeNull();
    expect(v.pendingCount).toBe(1);
    expect(v.pendingCells.has(pendingKey('{"$oid":"a"}', "x"))).toBe(true);
  });

  it("staged values survive a reload of the page", async () => {
    const v = await stagedView();
    qp.mockResolvedValueOnce(page());
    await v.goToPage(1);
    expect(v.docs[0].x).toBe("new");
    expect(v.docs[1].x).toBe("keep");
  });

  it("Commit writes the same minimal $set an immediate edit would", async () => {
    const v = await stagedView();
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    await v.commitPending();
    expect(upd).toHaveBeenCalledWith("conn:1", "d", "c", '{"_id": {"$oid":"a"}}', '{"$set":{"x":"new"}}', false);
    expect(v.pendingCount).toBe(0);
    expect(v.docs[0].x).toBe("new");
  });

  it("a failed Commit keeps the edit pending and shows the error", async () => {
    const v = await stagedView();
    upd.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    await v.commitPending();
    expect(v.pendingCount).toBe(1);
    expect(v.error).toBe("Query: boom");
  });

  it("Discard drops the edit and reloads the stored values", async () => {
    const v = await stagedView();
    qp.mockResolvedValueOnce(page());
    await v.discardPending();
    expect(v.pendingCount).toBe(0);
    expect(v.docs[0].x).toBe("old");
    expect(upd).not.toHaveBeenCalled();
  });

  it("with the setting off, edits save immediately as before", async () => {
    settings.setStageCellEdits(false);
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 });
    const v = await stagedView();
    expect(upd).toHaveBeenCalledTimes(1);
    expect(v.pendingCount).toBe(0);
  });
});

describe("createCollectionView — view presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(1);
    samp.mockResolvedValue([]);
    qp.mockResolvedValue([{ _id: 1, a: 1, b: 2, status: "x" }]);
    for (const p of viewPresets.list("conn:1/d/c")) viewPresets.remove("conn:1/d/c", p.name);
  });

  it("saves the applied filter and layout, then restores both", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    v.filterText = "{status: 'x'}";
    await v.applyFilter();
    await v.addSort("a");
    await v.toggleSortDirAt("a");
    v.togglePin("b");
    v.saveViewPreset("Mine");
    expect(v.presets.map((p) => p.name)).toEqual(["Mine"]);

    v.filterText = "{}";
    await v.applyFilter();
    await v.clearSort();
    v.togglePin("b");
    qp.mockClear();

    await v.applyViewPreset(v.presets[0]);
    expect(v.appliedFilter).toBe('{"status":"x"}');
    expect(v.sortKeys).toEqual([{ path: "a", dir: -1 }]);
    expect([...v.pinned]).toEqual(["b"]);
    expect(v.currentPage).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("conn:1", "d", "c", 0, 50, '{"status":"x"}', '{"a":-1,"_id":1}', null, 30000);
  });

  it("presets are shared by every view of the same namespace", async () => {
    const a = createCollectionView("conn:1", "d", "c");
    await a.init();
    a.saveViewPreset("Shared");
    const b = createCollectionView("conn:1", "d", "c");
    expect(b.presets.map((p) => p.name)).toEqual(["Shared"]);
    b.removeViewPreset("Shared");
    expect(a.presets).toEqual([]);
  });

  it("a preset with an unparseable filter changes nothing", async () => {
    const v = createCollectionView("conn:1", "d", "c");
    await v.init();
    qp.mockClear();
    await v.applyViewPreset({ name: "Bad", filter: "{oops", sort: [{ path: "a", dir: 1 }], hidden: [], pinned: ["a"], mode: "tree" });
    expect(v.filterError).toBe("err_filter_invalid_json");
    expect(v.sortKeys).toEqual([]);
    expect(v.view).toBe("grid");
    expect(qp).not.toHaveBeenCalled();
  });
});
