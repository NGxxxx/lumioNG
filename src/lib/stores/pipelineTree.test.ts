import { describe, it, expect, vi, beforeEach } from "vitest";

const aggregateMock = vi.fn(async (..._args: unknown[]) => [{ _id: 1 }]);
vi.mock("../api/documents", () => ({ aggregate: (...args: unknown[]) => aggregateMock(...args) }));

import { createPipelineTree } from "./pipelineTree.svelte";

function scriptBinding(initial: string) {
  let text = initial;
  return { get: () => text, set: (s: string) => { text = s; }, current: () => text };
}

describe("createPipelineTree", () => {
  beforeEach(() => {
    aggregateMock.mockClear();
  });
  it("parses the bound script into stages on syncFromScript", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    expect(tree.parseError).toBeNull();
    expect(tree.coll).toBe("orders");
    expect(tree.stages.map((s) => s.name)).toEqual(["$match"]);
  });

  it("sets parseError and leaves stages empty for an unparseable script", () => {
    const script = scriptBinding('db.getCollection("orders").find({})');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    expect(tree.parseError).not.toBeNull();
    expect(tree.stages).toEqual([]);
  });

  it("addStage inserts at the given index and writes the regenerated script back", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.addStage("$limit", 1);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match", "$limit"]);
    expect(script.current()).toContain('"$limit": 10');
  });

  it("does not re-parse its own just-written script on the next syncFromScript", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.addStage("$limit", 1);
    const stagesAfterAdd = tree.stages;
    tree.syncFromScript(); // script.get() now returns exactly what addStage just wrote
    expect(tree.stages).toBe(stagesAfterAdd); // same array reference: no re-parse happened
  });

  it("removeStage drops the stage and regenerates the script", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.removeStage(1);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match"]);
    expect(script.current()).not.toContain("$limit");
  });

  it("reorderStage moves a stage and preserves its id", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const limitId = tree.stages[1].id;
    tree.reorderStage(1, 0);
    expect(tree.stages.map((s) => s.name)).toEqual(["$limit", "$match"]);
    expect(tree.stages[0].id).toBe(limitId);
  });

  it("renameStage replaces the operator and resets its body to the default", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.renameStage(0, "$limit");
    expect(tree.stages[0]).toMatchObject({ name: "$limit", body: 10 });
  });

  it("runPreview calls aggregate with the pipeline truncated up to and including the stage", async () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const id = tree.stages[1].id;
    await tree.runPreview(id, "mydb");
    expect(aggregateMock).toHaveBeenCalledWith(
      "conn:1", "mydb", "orders", JSON.stringify([{ $match: { a: 1 } }, { $limit: 5 }]), 0, 20, null,
    );
    expect(tree.previewFor(id)).toMatchObject({ docs: [{ _id: 1 }], loading: false, error: null, hasRun: true });
  });

  it("invalidates downstream stage previews when an earlier stage is edited", async () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const limitId = tree.stages[1].id;
    await tree.runPreview(limitId, "mydb");
    expect(tree.previewFor(limitId).hasRun).toBe(true);
    tree.updateStageBody(0, { a: 2 });
    expect(tree.previewFor(limitId).hasRun).toBe(false);
  });

  it("blocks preview client-side when the truncated pipeline contains a write stage", async () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$out": "archive" }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const outId = tree.stages[1].id;
    await tree.runPreview(outId, "mydb");
    expect(tree.previewFor(outId).error).toBe("pipeline_tree_preview_write_stage_blocked");
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  it("requestPreview no-ops when autoPreview is off", () => {
    vi.useFakeTimers();
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.setAutoPreview(false);
    const id = tree.stages[0].id;
    tree.requestPreview(id, "mydb");
    vi.advanceTimersByTime(1000);
    expect(aggregateMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
