import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  queryPage: vi.fn(),
  replaceDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

import * as documents from "../api/documents";
import { createCollectionView } from "./collectionView.svelte";

const qp = documents.queryPage as ReturnType<typeof vi.fn>;
const del = documents.deleteDocument as ReturnType<typeof vi.fn>;
const repl = documents.replaceDocument as ReturnType<typeof vi.fn>;

describe("createCollectionView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loadMore append batch + derive keys", async () => {
    qp.mockResolvedValueOnce([{ _id: { $oid: "a" }, x: 1 }]);
    const v = createCollectionView("d", "c");
    await v.loadMore();
    expect(v.docs.length).toBe(1);
    expect(v.keys).toEqual(["_id", "x"]);
    expect(qp).toHaveBeenCalledWith("d", "c", null, 50);
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
});
