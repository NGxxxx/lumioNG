import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(),
  sampleDocuments: vi.fn(),
  replaceDocument: vi.fn(),
  deleteDocument: vi.fn(),
  fetchFullDoc: vi.fn(),
}));

import * as documents from "../api/documents";
import { createCollectionView } from "./collectionView.svelte";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const del = documents.deleteDocument as ReturnType<typeof vi.fn>;
const repl = documents.replaceDocument as ReturnType<typeof vi.fn>;
const samp = documents.sampleDocuments as ReturnType<typeof vi.fn>;
const full = documents.fetchFullDoc as ReturnType<typeof vi.fn>;

describe("createCollectionView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loadMore append batch + derive columns", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    expect(v.docs.length).toBe(1);
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(qp).toHaveBeenCalledWith("d", "c", { afterId: null }, 50, "{}", null, null);
  });

  it("batch rỗng → done=true, không còn gọi tiếp", async () => {
    qp.mockResolvedValueOnce([]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    expect(v.done).toBe(true);
    await v.loadMore();
    expect(qp).toHaveBeenCalledTimes(1);
  });

  it("loadMore lỗi → error được set", async () => {
    qp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionView("d", "c");
    await v.loadMore();
    expect(v.error).toBe("Query: boom");
  });

  it("confirmDelete gọi deleteDocument và bỏ doc khỏi danh sách", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    del.mockResolvedValueOnce(undefined);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    v.requestDelete(v.docs[0]);
    await v.confirmDelete();
    expect(del).toHaveBeenCalledWith("d", "c", '{"$oid":"a"}');
    expect(v.docs.length).toBe(0);
  });

  it("commitEdit hợp lệ → gọi replaceDocument và cập nhật cell", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hello" }]);
    repl.mockResolvedValueOnce(undefined);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    v.startEdit(0, "x");
    v.editText = "world";
    await v.commitEdit();
    expect(repl).toHaveBeenCalled();
    expect(v.docs[0].x).toBe("world");
    expect(v.editing).toBeNull();
  });

  it("applyFilter cú pháp sai → set filterError, không gọi queryPage", async () => {
    const v = createCollectionView("d", "c");
    v.filterText = "{bad";
    await v.applyFilter();
    expect(v.filterError).not.toBeNull();
    expect(qp).not.toHaveBeenCalled();
  });

  it("applyFilter hợp lệ → reset docs và gọi queryPage với filter", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    v.filterText = '{"x":2}';
    await v.applyFilter();
    expect(v.filterError).toBeNull();
    expect(v.docs.length).toBe(1);
    expect(qp).toHaveBeenLastCalledWith("d", "c", { skip: 0 }, 50, '{"x":2}', null, null);
  });

  it("phân trang giữ filter đã apply", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 2 }]);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const v = createCollectionView("d", "c");
    v.filterText = '{"x":2}';
    await v.applyFilter();
    await v.loadMore();
    expect(qp).toHaveBeenLastCalledWith("d", "c", { skip: 1 }, 50, '{"x":2}', null, null);
  });

  it("applyFilter khi đang loadMore → bỏ kết quả cũ, dùng filter mới", async () => {
    let resolveOld!: (v: unknown) => void;
    qp.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    const v = createCollectionView("d", "c");
    const p1 = v.loadMore(); // in flight (old filter "{}")
    v.filterText = '{"x":2}';
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]); // result for the new filter
    const p2 = v.applyFilter();
    resolveOld([{ _id: { $oid: "a" }, x: 1 }]); // stale request resolves AFTER filter change
    await p1;
    await p2;
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, x: 2 }]); // stale batch discarded
    expect(qp).toHaveBeenLastCalledWith("d", "c", { skip: 0 }, 50, '{"x":2}', null, null);
  });

  it("init gọi sampleDocuments + set schema (columnFields có metadata)", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    samp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "s" }]);
    const v = createCollectionView("d", "c");
    await v.init();
    expect(samp).toHaveBeenCalledWith("d", "c", "{}", 100);
    const col = v.columnFields.find((c) => c.path === "x")!;
    expect(col.type).toBe("string");
  });

  it("applyFilter re-sample với appliedFilter", async () => {
    qp.mockResolvedValue([{ _id: { $oid: "a" }, x: 2 }]);
    samp.mockResolvedValue([{ _id: { $oid: "a" }, x: 2 }]);
    const v = createCollectionView("d", "c");
    v.filterText = '{"x":2}';
    await v.applyFilter();
    expect(samp).toHaveBeenLastCalledWith("d", "c", '{"x":2}', 100);
  });

  it("sample lỗi → schema null, cột degrade row-derived, không throw", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    samp.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const v = createCollectionView("d", "c");
    await v.init();
    expect(v.columnFields.map((c) => c.path)).toEqual(["_id", "x"]);
    expect(v.columnFields.find((c) => c.path === "x")!.type).toBeUndefined();
  });

  it("toggleSort → skip-mode + sort doc, reset docs", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, age: 1 }]); // load đầu (pristine)
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, age: 2 }]); // sau khi sort
    const v = createCollectionView("d", "c");
    await v.loadMore();
    await v.toggleSort("age", false);
    expect(v.docs).toEqual([{ _id: { $oid: "b" }, age: 2 }]);
    expect(qp).toHaveBeenLastCalledWith("d", "c", { skip: 0 }, 50, "{}", '{"age":1,"_id":1}', null);
  });

  it("setPageSize đổi limit và reset docs", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    qp.mockResolvedValueOnce([{ _id: { $oid: "b" }, x: 2 }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    await v.setPageSize(10);
    expect(v.pageSize).toBe(10);
    expect(qp).toHaveBeenLastCalledWith("d", "c", { afterId: null }, 10, "{}", null, null);
  });

  it("toggleHiddenDraft KHÔNG gọi queryPage cho tới khi applyProjection", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1, secret: 9 }]);
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    expect(qp).toHaveBeenCalledTimes(1); // chưa apply
    await v.applyProjection();
    expect(v.hidden.has("secret")).toBe(true);
    expect(qp).toHaveBeenLastCalledWith("d", "c", { afterId: null }, 50, "{}", null, '{"secret":0}');
  });

  it("startEdit khi đang projection → re-fetch full doc trước khi sửa", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // grid (đã ẩn secret)
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]); // reload sau applyProjection
    full.mockResolvedValueOnce({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    const v = createCollectionView("d", "c");
    await v.loadMore();
    v.resetProjectionDraft();
    v.toggleHiddenDraft("secret");
    await v.applyProjection();
    await v.startEdit(0, "x");
    expect(full).toHaveBeenCalledWith("d", "c", '{"$oid":"a"}');
    expect(v.docs[0]).toEqual({ _id: { $oid: "a" }, x: "hi", secret: 9 });
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });

  it("startEdit khi KHÔNG projection → không gọi fetchFullDoc", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: "hi" }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    await v.startEdit(0, "x");
    expect(full).not.toHaveBeenCalled();
    expect(v.editing).toEqual({ row: 0, key: "x" });
  });
});
