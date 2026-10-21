import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  insertDocument: vi.fn().mockResolvedValue('{"$oid":"64a"}'),
  replaceDocument: vi.fn().mockResolvedValue(undefined),
  fetchFullDoc: vi.fn().mockResolvedValue({ _id: 1, a: "full", big: "x" }),
  queryPage: vi.fn().mockResolvedValue([{ _id: 1 }, { _id: 2 }]),
  fetchRawDocs: vi.fn(),
  deleteDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../api/csfle", () => ({ csfleSessionEnabled: vi.fn(async () => false) }));

import { queryPage, fetchRawDocs, insertDocument } from "../api/documents";
import { csfleSessionEnabled } from "../api/csfle";
import { insertWithUndo, replaceWithUndo, snapshotForUndo, recordDelete, duplicateSource, UNDO_DELETE_CAP } from "./documentWrites";
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

  it("snapshot on an encrypting session reads the stored ciphertext, and undo of the delete re-inserts it verbatim", async () => {
    const cipher = { $binary: { base64: "AQID", subType: "06" } };
    vi.mocked(csfleSessionEnabled).mockResolvedValueOnce(true);
    vi.mocked(fetchRawDocs).mockResolvedValueOnce([{ _id: 1, ssn: cipher }]);
    const snap = await snapshotForUndo("s", "d", "c", ["1"]);
    expect(fetchRawDocs).toHaveBeenCalledWith("s", "d", "c", ["1"]);
    expect(queryPage).not.toHaveBeenCalled();
    recordDelete("s", "d", "c", snap);
    await undo.undoLast();
    expect(JSON.parse(vi.mocked(insertDocument).mock.calls.at(-1)![3])).toEqual({ _id: 1, ssn: cipher });
  });

  it("Duplicate on an encrypting session copies the raw document (no _id); other sessions keep the grid copy", async () => {
    const cipher = { $binary: { base64: "AQID", subType: "06" } };
    vi.mocked(csfleSessionEnabled).mockResolvedValueOnce(true);
    vi.mocked(fetchRawDocs).mockResolvedValueOnce([{ _id: 1, name: "Ann", ssn: cipher }]);
    const dup = await duplicateSource("s", "d", "c", { _id: 1, name: "Ann", ssn: "123-45" });
    expect(fetchRawDocs).toHaveBeenCalledWith("s", "d", "c", ["1"]);
    expect(dup).toEqual({ name: "Ann", ssn: cipher });

    vi.mocked(fetchRawDocs).mockClear();
    expect(await duplicateSource("s", "d", "c", { _id: 1, name: "Ann" })).toEqual({ name: "Ann" });
    expect(fetchRawDocs).not.toHaveBeenCalled();
  });

  it("Duplicate refuses (rather than falling back to plain text) when the raw read fails", async () => {
    vi.mocked(csfleSessionEnabled).mockResolvedValueOnce(true);
    vi.mocked(fetchRawDocs).mockRejectedValueOnce(new Error("boom"));
    await expect(duplicateSource("s", "d", "c", { _id: 1, ssn: "123-45" })).rejects.toThrow();
  });
});
