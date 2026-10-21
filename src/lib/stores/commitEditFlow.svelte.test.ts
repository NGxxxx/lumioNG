import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/documents", () => ({
  updateOne: vi.fn(),
  fetchFullDoc: vi.fn(), replaceDocument: vi.fn(), insertDocument: vi.fn(), deleteDocument: vi.fn(),
}));
import { updateOne } from "../api/documents";
import { createCommitEditFlow } from "./commitEditFlow.svelte";
import { undo } from "./undo.svelte";

const upd = updateOne as ReturnType<typeof vi.fn>;

function setup() {
  let docs = [{ _id: 1, ssn: "123-45" }];
  const edit = { editing: { row: 0, key: "ssn", kind: "inline" as const }, editText: "999-99", editError: null as string | null, clear: vi.fn() };
  const flow = createCommitEditFlow({
    getSessionId: () => "s", edit, getDocs: () => docs, setDocs: (d) => { docs = d as typeof docs; },
    getTarget: () => ({ db: "d", coll: "c" }), noIdMessage: () => "no id", currentGeneration: () => 1,
  });
  return { flow, edit, docs: () => docs };
}

beforeEach(() => vi.clearAllMocks());

describe("commitEditFlow — encrypted cells", () => {
  it("shows the backend's refusal pointing to the document editor and changes nothing locally", async () => {
    upd.mockRejectedValue({ kind: "Query", message: "csfle_plaintext_required:ssn" });
    const undoBefore = undo.entries.length;
    const { flow, edit, docs } = setup();
    await flow.commitEdit();
    expect(edit.editError).toMatch(/ssn/);
    expect(edit.editError).toMatch(/document editor/);
    expect(edit.clear).not.toHaveBeenCalled();
    expect(docs()[0].ssn).toBe("123-45");
    expect(undo.entries.length).toBe(undoBefore);
  });
});
