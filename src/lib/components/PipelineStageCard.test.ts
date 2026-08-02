import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { flushSync } from "svelte";
import PipelineStageCard from "./PipelineStageCard.svelte";
import type { StageEntry } from "../domain/pipelineStages";

function fakeTree(stages: StageEntry[]) {
  return {
    stages,
    autoPreview: true,
    previewFor: vi.fn(() => ({ docs: [], loading: false, error: null, hasRun: false })),
    updateStageBody: vi.fn(),
    renameStage: vi.fn(),
    removeStage: vi.fn(),
    reorderStage: vi.fn(),
    requestPreview: vi.fn(),
    runPreview: vi.fn(),
  };
}

describe("PipelineStageCard", () => {
  it("renders a TreeEditor for an object-bodied stage", () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { a: 1 } }]);
    const { container } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    expect(container.querySelector(".tree-wrap")).not.toBeNull(); // TreeEditor's own root class
  });

  it("renders a single leaf input for a scalar-bodied stage", () => {
    const tree = fakeTree([{ id: "s1", name: "$limit", body: 10 }]);
    const { container } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    expect(container.querySelector("input.leaf")).not.toBeNull(); // TreeLeafInput's own input class
  });

  it("requests an initial preview on mount", () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { a: 1 } }]);
    render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    expect(tree.requestPreview).toHaveBeenCalledWith("s1", "mydb");
  });

  it("re-requests the preview against the new db when db changes for an already-mounted card", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { a: 1 } }]);
    const { rerender } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    expect(tree.requestPreview).toHaveBeenCalledWith("s1", "mydb");
    tree.requestPreview.mockClear();

    await rerender({ tree: tree as never, index: 0, db: "otherdb" });
    flushSync();
    expect(tree.requestPreview).toHaveBeenCalledWith("s1", "otherdb");
  });

  it("calls removeStage with this card's index when the remove button is clicked", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]);
    const { getByLabelText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    await fireEvent.click(getByLabelText("Remove stage"));
    expect(tree.removeStage).toHaveBeenCalledWith(0);
  });

  it("calls renameStage when a different operator is picked", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]);
    const { container } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    const select = container.querySelector("select.stage-name") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "$limit" } });
    expect(tree.renameStage).toHaveBeenCalledWith(0, "$limit");
  });
});
