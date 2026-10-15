import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn().mockResolvedValue('{"$oid":"64a"}'),
  replaceDocument: vi.fn().mockResolvedValue(undefined),
  fetchFullDoc: vi.fn().mockResolvedValue({ _id: 1, a: "full", big: "x" }),
  queryPage: vi.fn().mockResolvedValue([{ _id: 1 }, { _id: 2 }]),
}));

import { queryPage } from "../api/documents";
import { insertWithUndo, replaceWithUndo, snapshotForUndo, UNDO_DELETE_CAP } from "./documentWrites";
import { undo } from "./undo.svelte";

beforeEach(() => vi.clearAllMocks());

describe("documentWrites", () => {
  it("insert records the server-assigned _id", async () => {
    await insertWithUndo("s", "d", "c", { n: 1 });
    expect(undo.entries[0]).toMatchObject({ kind: "insert", doc: { _id: { $oid: "64a" }, n: 1 } });
  });

  it("replace records the full before-image read from the server", async () => {
    await replaceWithUndo("s", "d", "c", "1", { _id: 1, a: "new" });
    expect(undo.entries[0]).toMatchObject({ kind: "replace", before: { a: "full", big: "x" }, after: { a: "new" } });
  });

  it("snapshot fetches full docs by _id, and skips above the cap", async () => {
    expect(await snapshotForUndo("s", "d", "c", ["1", "2"])).toHaveLength(2);
    expect(queryPage).toHaveBeenCalledWith("s", "d", "c", 0, 2, '{"_id":{"$in":[1,2]}}');
    vi.mocked(queryPage).mockClear();
    const many = Array.from({ length: UNDO_DELETE_CAP + 1 }, (_, i) => String(i));
    expect(await snapshotForUndo("s", "d", "c", many)).toBeNull();
    expect(queryPage).not.toHaveBeenCalled();
  });
});
