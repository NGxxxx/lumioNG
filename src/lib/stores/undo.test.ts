import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  fetchFullDoc: vi.fn(),
  replaceDocument: vi.fn().mockResolvedValue(undefined),
  updateOne: vi.fn().mockResolvedValue({ matched: 1, modified: 1 }),
  insertDocument: vi.fn().mockResolvedValue("{}"),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));

import { fetchFullDoc, replaceDocument, updateOne, insertDocument, deleteDocument } from "../api/documents";
import { createUndo } from "./undo.svelte";
import { toast } from "./toast.svelte";
import type { Doc } from "../domain/doc";

const NS = { sessionId: "s", db: "shop", coll: "orders" };
const before: Doc = { _id: 1, status: "a" };
const after: Doc = { _id: 1, status: "b" };

beforeEach(() => {
  vi.clearAllMocks();
  for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe("undo", () => {
  it("keeps the newest 20 entries", () => {
    const u = createUndo();
    for (let i = 0; i < 25; i++) u.record({ ...NS, kind: "insert", doc: { _id: i } });
    expect(u.entries).toHaveLength(20);
    expect((u.entries[0] as { doc: Doc }).doc._id).toBe(24);
  });

  it("recording shows a toast with an Undo action", () => {
    const u = createUndo();
    u.record({ ...NS, kind: "replace", before, after });
    expect(toast.toasts.at(-1)?.action?.label).toBe("Undo");
  });

  it("replace: writes the before-image when the document still equals the after-image", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ status: "b", _id: 1 });
    const u = createUndo();
    u.record({ ...NS, kind: "replace", before, after });
    expect(await u.undoLast()).toBe("ok");
    expect(replaceDocument).toHaveBeenCalledWith("s", "shop", "orders", "1", JSON.stringify(before));
    expect(u.entries).toHaveLength(0);
  });

  it("a conflict writes nothing until confirmOverwrite", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ _id: 1, status: "c" });
    const u = createUndo();
    u.record({ ...NS, kind: "replace", before, after });
    expect(await u.undoLast()).toBe("conflict");
    expect(replaceDocument).not.toHaveBeenCalled();
    expect(u.conflict).not.toBeNull();
    await u.confirmOverwrite();
    expect(replaceDocument).toHaveBeenCalled();
    expect(u.conflict).toBeNull();
  });

  it("cell: $unset when the field did not exist before", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ _id: 1, tag: "x" });
    const u = createUndo();
    u.record({ ...NS, kind: "cell", idJson: "1", path: "tag", before: undefined, after: "x" });
    await u.undoLast();
    expect(updateOne).toHaveBeenCalledWith("s", "shop", "orders", '{"_id": 1}', '{"$unset":{"tag":""}}', false);
  });

  it("insert: deletes the inserted _id", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ _id: 7, n: 1 });
    const u = createUndo();
    u.record({ ...NS, kind: "insert", doc: { _id: 7, n: 1 } });
    await u.undoLast();
    expect(deleteDocument).toHaveBeenCalledWith("s", "shop", "orders", "7");
  });

  it("delete: re-inserts each document and reports a partial restore", async () => {
    vi.mocked(insertDocument).mockResolvedValueOnce("{}").mockRejectedValueOnce(new Error("E11000 duplicate key")).mockResolvedValueOnce("{}");
    const u = createUndo();
    u.record({ ...NS, kind: "delete", docs: [{ _id: 1 }, { _id: 2 }, { _id: 3 }] });
    expect(await u.undoLast()).toBe("partial");
    expect(insertDocument).toHaveBeenCalledTimes(3);
    expect(toast.toasts.at(-1)?.message).toBe("Restored 2 of 3 — 1 _id already exist");
  });

  it("undo bumps `changed` so views of that namespace can reload", async () => {
    const u = createUndo();
    u.record({ ...NS, kind: "delete", docs: [{ _id: 1 }] });
    await u.undoLast();
    expect(u.changed).toMatchObject({ sessionId: "s", db: "shop", coll: "orders" });
  });

  it("undoLast with nothing recorded says so", async () => {
    const u = createUndo();
    expect(await u.undoLast()).toBe("empty");
  });

  it("documents that failed to restore for another reason stay in the undo list", async () => {
    vi.mocked(insertDocument).mockReset()
      .mockRejectedValueOnce(new Error("E11000 duplicate key"))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce("{}");
    const u = createUndo();
    u.record({ ...NS, kind: "delete", docs: [{ _id: 1 }, { _id: 2 }, { _id: 3 }] });
    expect(await u.undoLast()).toBe("partial");
    expect(u.entries).toHaveLength(1);
    expect((u.entries[0] as { docs: Doc[] }).docs).toEqual([{ _id: 2 }]);
    vi.mocked(insertDocument).mockResolvedValue("{}");
  });

  it("a cell undo on a document that no longer matches reports the failure", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ _id: 1, tag: "x" });
    vi.mocked(updateOne).mockResolvedValueOnce({ matched: 0, modified: 0 });
    const u = createUndo();
    u.record({ ...NS, kind: "cell", idJson: "1", path: "tag", before: "a", after: "x" });
    expect(await u.undoLast()).toBe("failed");
    expect(toast.toasts.at(-1)).toMatchObject({ kind: "error" });
  });

  it("the cell-edit toast names the field", () => {
    const u = createUndo();
    u.record({ ...NS, kind: "cell", idJson: "1", path: "status", before: "a", after: "b" });
    expect(toast.toasts.at(-1)?.message).toBe("Updated status");
  });

  it("changed carries the affected _ids", async () => {
    vi.mocked(fetchFullDoc).mockResolvedValue({ status: "b", _id: 1 });
    const u = createUndo();
    u.record({ ...NS, kind: "replace", before, after });
    await u.undoLast();
    expect(u.changed?.ids).toEqual(["1"]);
  });
});
