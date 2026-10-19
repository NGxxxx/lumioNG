import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const aggregateMock = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [{ _id: 1 }]);
vi.mock("../api/documents", () => ({ aggregate: (...args: unknown[]) => aggregateMock(...args) }));
const listIndexesMock = vi.fn(async (..._a: unknown[]) => ['{"key":{"_id":1}}']);
vi.mock("../api/indexes", () => ({ listIndexes: (...a: unknown[]) => listIndexesMock(...a) }));

import { createPipelineTree, resetClipboardForTests } from "./pipelineTree.svelte";

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
      "conn:1", "mydb", "orders", JSON.stringify([{ $match: { a: 1 } }, { $limit: 5 }]), 0, 20, 30000,
    );
    expect(tree.previewFor(id)).toMatchObject({ docs: [{ _id: 1 }], loading: false, error: null, hasRun: true });
  });

  it("discards a stale preview response that resolves after a fresher one for the same stage", async () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const id = tree.stages[0].id;

    let resolveFirst!: (docs: { _id: number }[]) => void;
    let resolveSecond!: (docs: { _id: number }[]) => void;
    aggregateMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const firstCall = tree.runPreview(id, "mydb");
    const secondCall = tree.runPreview(id, "mydb");

    // Second (fresher) call's response arrives first...
    resolveSecond([{ _id: 2 }]);
    await secondCall;
    // ...then the stale first call's response arrives late — it must not overwrite the fresher one.
    resolveFirst([{ _id: 1 }]);
    await firstCall;

    expect(tree.previewFor(id).docs).toEqual([{ _id: 2 }]);
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

  it("invalidates downstream stage previews when a new stage is inserted before them", async () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const matchId = tree.stages[0].id;
    await tree.runPreview(matchId, "mydb");
    expect(tree.previewFor(matchId).hasRun).toBe(true);
    tree.addStage("$limit", 0); // inserted before $match, whose composed pipeline is now different
    expect(tree.previewFor(matchId).hasRun).toBe(false);
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

  it("debounces the regenerate() triggered by updateStageBody, collapsing rapid keystroke-driven edits into one script.set()", () => {
    vi.useFakeTimers();
    let current = 'db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])';
    const setSpy = vi.fn((s: string) => { current = s; });
    const binding = { get: () => current, set: setSpy };
    const tree = createPipelineTree("conn:1", binding);
    tree.syncFromScript();

    tree.updateStageBody(0, { a: 2 });
    tree.updateStageBody(0, { a: 3 });
    tree.updateStageBody(0, { a: 4 });
    expect(setSpy).not.toHaveBeenCalled(); // no synchronous regenerate() per call

    vi.advanceTimersByTime(120);
    expect(setSpy).toHaveBeenCalledTimes(1); // coalesced into a single regenerate()
    expect(current).toContain('"a": 4');
    vi.useRealTimers();
  });

  it("exposes the sessionId it was created with", () => {
    const tree = createPipelineTree("conn:42", scriptBinding('db.getCollection("orders").aggregate([])'));
    expect(tree.sessionId).toBe("conn:42");
  });

  it("defaults autoPreview to off", () => {
    const tree = createPipelineTree("conn:1", scriptBinding('db.getCollection("orders").aggregate([])'));
    expect(tree.autoPreview).toBe(false);
  });

  it("requestPreview no-ops when autoPreview is off", () => {
    vi.useFakeTimers();
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const id = tree.stages[0].id;
    tree.requestPreview(id, "mydb");
    vi.advanceTimersByTime(1000);
    expect(aggregateMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("createPipelineTree — stage clipboard (cut/copy/paste/duplicate)", () => {
  beforeEach(() => {
    resetClipboardForTests();
  });

  it("hasClipboard starts false", () => {
    const tree = createPipelineTree("conn:1", scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])'));
    expect(tree.hasClipboard).toBe(false);
  });

  it("copyStage populates the clipboard without removing the stage", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.copyStage(0);
    expect(tree.hasClipboard).toBe(true);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match"]);
  });

  it("cutStage populates the clipboard and removes the stage", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.cutStage(0);
    expect(tree.hasClipboard).toBe(true);
    expect(tree.stages.map((s) => s.name)).toEqual(["$limit"]);
  });

  it("pasteStageAfter inserts a fresh-id copy of the clipboard stage right after the given index", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }, { "$limit": 5 }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const matchId = tree.stages[0].id;
    tree.copyStage(0);
    tree.pasteStageAfter(1);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match", "$limit", "$match"]);
    expect(tree.stages[2].id).not.toBe(matchId);
  });

  it("pasteStageAfter is a no-op when the clipboard is empty", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    tree.pasteStageAfter(0);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match"]);
  });

  it("duplicateStage inserts a fresh-id copy of the stage right after itself", () => {
    const script = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const tree = createPipelineTree("conn:1", script);
    tree.syncFromScript();
    const originalId = tree.stages[0].id;
    tree.duplicateStage(0);
    expect(tree.stages.map((s) => s.name)).toEqual(["$match", "$match"]);
    expect(tree.stages[1].id).not.toBe(originalId);
  });

  it("copying a stage in one tree and pasting in a different tree works (shared clipboard)", () => {
    const scriptA = scriptBinding('db.getCollection("orders").aggregate([{ "$match": { "a": 1 } }])');
    const treeA = createPipelineTree("conn:1", scriptA);
    treeA.syncFromScript();
    treeA.copyStage(0);

    const scriptB = scriptBinding('db.getCollection("customers").aggregate([{ "$limit": 5 }])');
    const treeB = createPipelineTree("conn:2", scriptB);
    treeB.syncFromScript();
    expect(treeB.hasClipboard).toBe(true);
    treeB.pasteStageAfter(0);
    expect(treeB.stages.map((s) => s.name)).toEqual(["$limit", "$match"]);
  });
});

describe("pipelineTree — builder (selection, counts, preview)", () => {
  const SCRIPT = 'db.getCollection("orders").aggregate([{ "$match": { "s": "a" } }, { "$group": { "_id": "$t", "count": { "$sum": 1 } } }, { "$sort": { "count": -1 } }])';
  function setup(script = SCRIPT) {
    const text = { v: script };
    const show = vi.fn();
    const clear = vi.fn();
    const tree = createPipelineTree("conn:1", {
      get: () => text.v, set: (t: string) => { text.v = t; },
      db: () => "shop", preview: { show, clear },
    });
    tree.syncFromScript();
    return { tree, text, show, clear };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    aggregateMock.mockReset();
    aggregateMock.mockImplementation(async (..._a: unknown[]) => [{ _id: 1 }]);
  });
  afterEach(() => vi.useRealTimers());

  it("selecting a stage previews the pipeline through it (20-doc sample) into the result pane", async () => {
    const { tree, show } = setup();
    tree.select(tree.stages[1].id);
    await vi.advanceTimersByTimeAsync(460);
    const call = aggregateMock.mock.calls.find((c) => !String(c[3]).includes("$count"))!;
    expect(JSON.parse(call[3] as string)).toEqual([{ $match: { s: "a" } }, { $group: { _id: "$t", count: { $sum: 1 } } }]);
    expect(call[5]).toBe(20);
    expect(show).toHaveBeenCalledWith([{ _id: 1 }], { stage: 2, of: 3 });
  });

  it("deselecting brings the run's result back", async () => {
    const { tree, clear } = setup();
    tree.select(tree.stages[0].id);
    tree.select(null);
    expect(clear).toHaveBeenCalled();
  });

  it("an edit during an in-flight preview discards the older result", async () => {
    const { tree, show } = setup();
    let release!: (v: unknown[]) => void;
    aggregateMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    tree.select(tree.stages[0].id);
    await vi.advanceTimersByTimeAsync(460);
    tree.updateStageBody(0, { s: "b" });
    await vi.advanceTimersByTimeAsync(460);
    release([{ old: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(show).not.toHaveBeenCalledWith([{ old: true }], expect.anything());
  });

  it("counts every stage; a failure shows as error", async () => {
    aggregateMock.mockImplementation(async (...a: unknown[]) => {
      const p = JSON.parse(a[3] as string) as object[];
      if (p.length === 4) throw new Error("timeout"); // 3 stages + $count
      return [{ n: (p.length - 1) * 10 + 10 }];
    });
    const { tree } = setup();
    tree.refreshCounts();
    await vi.advanceTimersByTimeAsync(460);
    const [a, b, c] = tree.stages.map((s) => tree.counts[s.id]);
    expect([a, b, c]).toEqual([20, 30, "error"]);
  });

  it("reads counts the way the backend sends them (Canonical Extended JSON numbers)", async () => {
    aggregateMock.mockImplementation(async (...a: unknown[]) => {
      const p = JSON.parse(a[3] as string) as object[];
      return p.length === 2 ? [{ n: { $numberInt: "13924" } }] : [{ n: { $numberLong: "5000000000" } }];
    });
    const { tree } = setup();
    tree.refreshCounts();
    await vi.advanceTimersByTimeAsync(460);
    const [a, b] = tree.stages.map((s) => tree.counts[s.id]);
    expect([a, b]).toEqual([13924, 5000000000]);
  });

  it("a disabled stage leaves the script and comes back where it was", () => {
    const { tree, text } = setup();
    tree.setEnabled(1, false);
    expect(text.v).not.toContain("$group");
    expect(tree.stages[1].enabled).toBe(false);
    tree.setEnabled(1, true);
    expect(text.v.indexOf("$group")).toBeLessThan(text.v.indexOf("$sort"));
  });

  it("editing the script directly drops disabled stages and says so", () => {
    const { tree, text } = setup();
    tree.setEnabled(1, false);
    text.v = text.v.replace('"a"', '"z"');
    tree.syncFromScript();
    expect(tree.discardedNotice).toBe(1);
    expect(tree.stages).toHaveLength(2);
  });

  it("syncing never rewrites the script text", () => {
    const original = 'db.getCollection("orders").aggregate([{ "$match": { "$expr": { "$gt": ["$a", 1] } } }])';
    const { text } = setup(original);
    expect(text.v).toBe(original);
  });

  it("a $out stage stops counting and preview at that point", async () => {
    const { tree, show } = setup('db.getCollection("orders").aggregate([{ "$match": {} }, { "$out": "x" }])');
    tree.select(tree.stages[1].id);
    tree.refreshCounts();
    await vi.advanceTimersByTimeAsync(460);
    expect(aggregateMock.mock.calls.every((c) => !String(c[3]).includes("$out"))).toBe(true);
    expect(show).not.toHaveBeenCalled();
    expect(tree.warnings.some((w) => w.key === "writes_disable_preview")).toBe(true);
  });

  it("templates append their stages; next-step chips follow the last stage", () => {
    const { tree } = setup('db.getCollection("orders").aggregate([])');
    tree.applyTemplate("topN", { field: "status", n: 5 });
    expect(tree.stages.map((s) => s.name)).toEqual(["$group", "$sort", "$limit"]);
    expect(tree.nextSteps.length).toBe(0); // last is $limit
  });

  it("moveMatchFirst puts a late $match before the first reshaping stage", () => {
    const { tree } = setup('db.getCollection("o").aggregate([{ "$limit": 5 }, { "$group": { "_id": "$a" } }, { "$match": { "_id": 1 } }])');
    tree.moveMatchFirst();
    expect(tree.stages.map((s) => s.name)).toEqual(["$limit", "$match", "$group"]);
  });
});
