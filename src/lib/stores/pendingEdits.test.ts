import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  updateOne: vi.fn(),
  fetchFullDoc: vi.fn(), replaceDocument: vi.fn(), insertDocument: vi.fn(), deleteDocument: vi.fn(),
}));

import { updateOne } from "../api/documents";
import { pendingEdits } from "./pendingEdits.svelte";
import { undo } from "./undo.svelte";
import { commandLog } from "./commandLog.svelte";

const upd = updateOne as ReturnType<typeof vi.fn>;
const edit = (id: string, path: string, before: unknown, after: unknown) => ({ idJson: id, path, before, after });

describe("pendingEdits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingEdits.dropSession("s");
    pendingEdits.dropSession("t");
    upd.mockResolvedValue({ matched: 1, modified: 1 });
  });

  it("keeps edits per namespace and counts them per session", () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    pendingEdits.stage("s", "d", "other", edit("1", "a", 1, 2));
    pendingEdits.stage("t", "d", "c", edit("1", "a", 1, 2));
    expect(pendingEdits.list("s", "d", "c")).toHaveLength(1);
    expect(pendingEdits.count("s")).toBe(2);
    expect(pendingEdits.count()).toBe(3);
    pendingEdits.dropSession("s");
    expect(pendingEdits.count()).toBe(1);
  });

  it("commits in order with one $set per cell — the same write an immediate edit makes", async () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    pendingEdits.stage("s", "d", "c", edit('{"$oid":"x"}', "n.b", "p", "q"));
    const undoBefore = undo.entries.length;
    const r = await pendingEdits.commit("s", "d", "c");
    expect(r).toEqual({ committed: 2, missing: 0, error: null });
    expect(upd.mock.calls).toEqual([
      ["s", "d", "c", '{"_id": 1}', '{"$set":{"a":2}}', false],
      ["s", "d", "c", '{"_id": {"$oid":"x"}}', '{"$set":{"n.b":"q"}}', false],
    ]);
    expect(pendingEdits.list("s", "d", "c")).toEqual([]);
    expect(undo.entries.length).toBe(undoBefore + 2);
    expect(undo.entries[0]).toMatchObject({ kind: "cell", idJson: '{"$oid":"x"}', path: "n.b", before: "p", after: "q" });
    expect(commandLog.entries.at(-1)?.text).toContain("updateOne");
  });

  it("a failed write stops the commit and keeps that edit and the rest pending", async () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    pendingEdits.stage("s", "d", "c", edit("2", "a", 1, 2));
    pendingEdits.stage("s", "d", "c", edit("3", "a", 1, 2));
    upd.mockResolvedValueOnce({ matched: 1, modified: 1 }).mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const r = await pendingEdits.commit("s", "d", "c");
    expect(r.committed).toBe(1);
    expect(r.error).toBe("Query: boom");
    expect(pendingEdits.list("s", "d", "c").map((p) => p.idJson)).toEqual(["2", "3"]);
  });

  it("an edit whose document was deleted meanwhile is dropped and reported", async () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    upd.mockResolvedValueOnce({ matched: 0, modified: 0 });
    const undoBefore = undo.entries.length;
    const r = await pendingEdits.commit("s", "d", "c");
    expect(r).toEqual({ committed: 0, missing: 1, error: null });
    expect(pendingEdits.list("s", "d", "c")).toEqual([]);
    expect(undo.entries.length).toBe(undoBefore);
  });

  it("a second commit while one is running does nothing", async () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    let release!: () => void;
    upd.mockReturnValueOnce(new Promise((res) => { release = () => res({ matched: 1, modified: 1 }); }));
    const first = pendingEdits.commit("s", "d", "c");
    expect(pendingEdits.isCommitting("s", "d", "c")).toBe(true);
    expect(await pendingEdits.commit("s", "d", "c")).toEqual({ committed: 0, missing: 0, error: null });
    release();
    await first;
    expect(upd).toHaveBeenCalledTimes(1);
    expect(pendingEdits.isCommitting("s", "d", "c")).toBe(false);
  });

  it("discard clears one namespace", () => {
    pendingEdits.stage("s", "d", "c", edit("1", "a", 1, 2));
    pendingEdits.stage("s", "d", "e", edit("1", "a", 1, 2));
    pendingEdits.discard("s", "d", "c");
    expect(pendingEdits.count("s")).toBe(1);
  });

  it("stops at an edit the backend refuses because the field is encrypted and keeps it staged", async () => {
    upd.mockRejectedValueOnce({ kind: "Query", message: "csfle_plaintext_required:ssn" });
    pendingEdits.stage("s", "d", "c", edit("1", "ssn", "a", "b"));
    const r = await pendingEdits.commit("s", "d", "c");
    expect(r.committed).toBe(0);
    expect(r.error).toMatch(/document editor/);
    expect(pendingEdits.list("s", "d", "c")).toHaveLength(1);
  });
});
