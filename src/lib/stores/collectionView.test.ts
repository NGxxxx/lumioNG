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
  importDocuments: vi.fn(),
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
const impD = documents.importDocuments as ReturnType<typeof vi.fn>;
const cnt = documents.countDocuments as ReturnType<typeof vi.fn>;
const saveDlg = files.saveDialog as ReturnType<typeof vi.fn>;
const openDlg = files.openDialog as ReturnType<typeof vi.fn>;
const writeF = files.writeTextFile as ReturnType<typeof vi.fn>;

describe("createCollectionView — paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
  });

  it("init: đếm tổng + nạp trang 1 (skip 0) + derive columns", async () => {
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

  it("goToPage(3) gọi queryPage với skip đúng + replace docs", async () => {
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

  it("goToPage vượt pageCount → kẹp về trang cuối", async () => {
    cnt.mockResolvedValue(100); // pageCount = 2
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.goToPage(99);
    expect(v.currentPage).toBe(2);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 50, 50, "{}", null, null);
  });

  it("nextPage/prevPage di chuyển trang", async () => {
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

  it("loadPage lỗi → error được set", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.error).toBe("Query: boom");
  });

  it("applyFilter cú pháp sai → set filterError, không gọi queryPage", async () => {
    const v = createCollectionView("d", "c");
    v.filterText = "{bad";
    await v.applyFilter();
    expect(v.filterError).not.toBeNull();
    expect(qp).not.toHaveBeenCalled();
  });

  it("applyFilter hợp lệ → reset trang 1 + queryPage với filter mới", async () => {
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

  it("applyFilter khi đang nạp trang → bỏ kết quả cũ, dùng filter mới", async () => {
    cnt.mockResolvedValue(5);
    let resolveOld!: (v: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    samp.mockResolvedValue([]);
    const v = createCollectionView("d", "c");
    const p1 = v.goToPage(1); // in flight (filter "{}")
    v.filterText = '{"x":2}';
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const p2 = v.applyFilter();
    resolveOld([{ _id: { $oid: "a" }, x: 1 }]); // stale resolves sau khi đổi filter
    await p1;
    await p2;
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, x: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("d", "c", 0, 50, '{"x":2}', null, null);
  });

  it("goToPage race: kết quả trang cũ đến sau → bị bỏ, docs là trang mới nhất", async () => {
    cnt.mockResolvedValue(200); // pageCount = 4, đủ cho trang 2 và 3
    qp.mockResolvedValueOnce([]); // init trang 1
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();

    // Bắt đầu goToPage(2) nhưng để queryPage treo
    let resolvePage2!: (val: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolvePage2 = r)));

    const p2 = v.goToPage(2); // in-flight, chưa resolve

    // Gọi goToPage(3) ngay — resolve ngay lập tức
    qp.mockResolvedValueOnce([{ _id: { $oid: "p3" } }]);
    await v.goToPage(3); // resolve nhanh, docs = page 3

    // Bây giờ resolve muộn request của trang 2
    resolvePage2([{ _id: { $oid: "p2" } }]);
    await p2;

    // Trang 2 phải bị bỏ; docs vẫn là kết quả trang 3
    expect(v.docs).toEqual([{ _id: { $oid: "p3" } }]);
    expect(v.currentPage).toBe(3);
  });

  it("toggleSort → reset trang 1 + sort doc", async () => {
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

  it("setPageSize đổi limit + reset trang 1", async () => {
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

  it("confirmDelete gọi deleteDocument rồi reload (count + queryPage)", async () => {
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

  it("commitEdit hợp lệ → gọi replaceDocument và cập nhật cell", async () => {
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

  it("init gọi sampleDocuments + set schema (columnFields có metadata)", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(samp).toHaveBeenCalledWith("d", "c", "{}", 100);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBe("string");
  });

  it("sample lỗi → schema null, cột degrade row-derived, không throw", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBeUndefined();
  });

  it("toggleHiddenDraft KHÔNG gọi queryPage cho tới applyProjection", async () => {
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

  it("startEdit khi đang projection → re-fetch full doc trước khi sửa", async () => {
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

  it("startEdit khi KHÔNG projection → không gọi fetchFullDoc", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.startEdit(0, "x");
    expect(full).not.toHaveBeenCalled();
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });

  it("exportAs('json') ghi file nội dung JSON array", async () => {
    saveDlg.mockResolvedValueOnce("/tmp/c.json");
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    writeF.mockResolvedValueOnce(undefined);
    const v = createCollectionView("d", "c");
    await v.exportAs("json");
    expect(expQ).toHaveBeenCalledWith("d", "c", "{}", null, null);
    const [, content] = writeF.mock.calls[0];
    expect(JSON.parse(content)).toEqual([{ _id: { $oid: "a" }, x: 1 }]);
    expect(v.ioMessage).toContain("1");
  });

  it("exportAs('csv') ghi file nội dung CSV", async () => {
    saveDlg.mockResolvedValueOnce("/tmp/c.csv");
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    writeF.mockResolvedValueOnce(undefined);
    const v = createCollectionView("d", "c");
    await v.exportAs("csv");
    const [, content] = writeF.mock.calls[0];
    expect(content.split("\n")[0]).toBe("_id,x");
  });

  it("exportAs hủy dialog → không export/ghi", async () => {
    saveDlg.mockResolvedValueOnce(null);
    const v = createCollectionView("d", "c");
    await v.exportAs("json");
    expect(expQ).not.toHaveBeenCalled();
    expect(writeF).not.toHaveBeenCalled();
  });

  it("importDocs gọi importDocuments + reload + set message", async () => {
    openDlg.mockResolvedValueOnce("/tmp/in.json");
    impD.mockResolvedValueOnce({ inserted: 3, failed: 1, errors: ["dup"] });
    cnt.mockResolvedValueOnce(3); // reload count
    qp.mockResolvedValueOnce([]); // reload page
    const v = createCollectionView("d", "c");
    await v.importDocs();
    expect(impD).toHaveBeenCalledWith("d", "c", "/tmp/in.json");
    expect(v.ioMessage).toContain("3");
    expect(v.ioMessage).toContain("1");
    expect(qp).toHaveBeenCalled();
  });

  it("importDocs hủy dialog → không import", async () => {
    openDlg.mockResolvedValueOnce(null);
    const v = createCollectionView("d", "c");
    await v.importDocs();
    expect(impD).not.toHaveBeenCalled();
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

  it("dưới ngưỡng → export ngay, allShown=true", async () => {
    cnt.mockResolvedValueOnce(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(v.docs.length).toBe(3);
    expect(expQ).toHaveBeenCalledWith("d", "c", "{}", null, null);
  });

  it("trên ngưỡng → set showAllPending, CHƯA export", async () => {
    cnt.mockResolvedValueOnce(6000);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    expect(v.showAllPending).toBe(6000);
    expect(v.allShown).toBe(false);
    expect(expQ).not.toHaveBeenCalled();
  });

  it("confirmShowAll sau cảnh báo → export + allShown", async () => {
    cnt.mockResolvedValueOnce(6000);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }]);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    await v.confirmShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(true);
    expect(expQ).toHaveBeenCalled();
  });

  it("cancelShowAll → bỏ pending, không export", async () => {
    cnt.mockResolvedValueOnce(6000);
    const v = createCollectionView("d", "c");
    await v.requestShowAll();
    v.cancelShowAll();
    expect(v.showAllPending).toBeNull();
    expect(v.allShown).toBe(false);
  });

  it("đổi trang sau Show ALL → allShown về false", async () => {
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

  it("requestShowAll race: lần sau thắng, lần trước bị bỏ (stale-guard)", async () => {
    // Lần 1: count bị treo (above threshold nếu không bị guard → 6000)
    let resolveCount1!: (n: number) => void;
    cnt.mockImplementationOnce(() => new Promise<number>((r) => (resolveCount1 = r)));

    const v = createCollectionView("d", "c");
    const p1 = v.requestShowAll(); // in-flight, chưa resolve count

    // Lần 2: count dưới ngưỡng (3) → export ngay, allShown = true
    cnt.mockResolvedValueOnce(3);
    expQ.mockResolvedValueOnce([{ _id: { $oid: "a" } }, { _id: { $oid: "b" } }, { _id: { $oid: "c" } }]);
    await v.requestShowAll();

    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(expQ).toHaveBeenCalledTimes(1);

    // Resolve muộn count của lần 1 với giá trị TRÊN ngưỡng
    // Nếu stale-guard thiếu → lần 1 sẽ ghi đè showAllPending = 6000
    resolveCount1(6000);
    await p1;

    // Stale-guard phải chặn: trạng thái không bị hỏng
    expect(v.allShown).toBe(true);
    expect(v.showAllPending).toBeNull();
    expect(expQ).toHaveBeenCalledTimes(1); // expQ chỉ gọi 1 lần (lần 2)
  });
});

describe("command log instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cnt.mockResolvedValue(0);
    commandLog.clear();
  });

  it("nạp trang đẩy findCmd vào command log", async () => {
    cnt.mockResolvedValueOnce(1);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(commandLog.entries.some((e) => e.text === findCmd({ coll: "c", filter: "{}", projection: null, sort: null, limit: 50 }))).toBe(true);
  });

  it("confirmDelete đẩy deleteOneCmd", async () => {
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

  it("addSort → thêm khóa asc, reset trang 1, reload với sort", async () => {
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

  it("toggleSortDirAt → đảo chiều khóa đang có", async () => {
    cnt.mockResolvedValue(3);
    qp.mockResolvedValue([]);
    samp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.init();
    await v.addSort("age");
    await v.toggleSortDirAt("age");
    expect(v.sortKeys).toEqual([{ path: "age", dir: -1 }]);
  });

  it("moveSort dời ưu tiên; removeSort bỏ khóa; clearSort xóa hết", async () => {
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

  it("hideAllFieldsDraft ẩn mọi field trừ _id; showAllFieldsDraft xóa hết", async () => {
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

  it("menuItems prepends update/delete selected with the count", async () => {
    const v = await withTwoDocs();
    v.selectAll();
    v.openMenu(ev(), 0, "x");
    const actions = v.menuItems().map((i) => i.action);
    expect(actions.slice(0, 2)).toEqual(["updateSelected", "deleteSelected"]);
    const labels = v.menuItems().map((i) => i.label);
    expect(labels[0]).toContain("2");
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
