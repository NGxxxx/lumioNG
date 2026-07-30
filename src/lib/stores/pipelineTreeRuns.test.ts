import { describe, it, expect, vi } from "vitest";

vi.mock("../api/documents", () => ({ aggregate: vi.fn(async () => []) }));

import { getPipelineTree, disposePipelineTree } from "./pipelineTreeRuns.svelte";

function scriptBinding(initial: string) {
  let text = initial;
  return { get: () => text, set: (s: string) => { text = s; } };
}

describe("pipelineTreeRuns registry", () => {
  it("returns the same store instance for one id on repeat calls", () => {
    const a = getPipelineTree(201, "conn:1", scriptBinding("a"));
    const b = getPipelineTree(201, "conn:1", scriptBinding("b"));
    expect(b).toBe(a);
    disposePipelineTree(201);
  });

  it("returns distinct stores per id", () => {
    const a = getPipelineTree(202, "conn:1", scriptBinding("a"));
    const c = getPipelineTree(203, "conn:1", scriptBinding("c"));
    expect(c).not.toBe(a);
    disposePipelineTree(202);
    disposePipelineTree(203);
  });

  it("dispose drops the entry so the next get creates a fresh store", () => {
    const first = getPipelineTree(204, "conn:1", scriptBinding("first"));
    disposePipelineTree(204);
    const second = getPipelineTree(204, "conn:1", scriptBinding("second"));
    expect(second).not.toBe(first);
    disposePipelineTree(204);
  });
});
