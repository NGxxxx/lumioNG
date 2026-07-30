// src/lib/components/PipelineTreeEditor.test.ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import PipelineTreeEditor from "./PipelineTreeEditor.svelte";

function fakeTree(overrides: Partial<ReturnType<typeof baseTree>> = {}) {
  return { ...baseTree(), ...overrides };
}
function baseTree() {
  return {
    stages: [{ id: "s1", name: "$match", body: {} }],
    coll: "orders",
    parseError: null as string | null,
    autoPreview: true,
    setAutoPreview: vi.fn(),
    addStage: vi.fn(),
    removeStage: vi.fn(),
    reorderStage: vi.fn(),
    renameStage: vi.fn(),
    updateStageBody: vi.fn(),
    previewFor: vi.fn(() => ({ docs: [], loading: false, error: null, hasRun: false })),
    requestPreview: vi.fn(),
    runPreview: vi.fn(),
  };
}

describe("PipelineTreeEditor", () => {
  it("shows the parse-error banner instead of stages when parseError is set", () => {
    const tree = fakeTree({ parseError: "pipeline_tree_parse_error" });
    const { getByText, queryByText } = render(PipelineTreeEditor, { props: { tree: tree as never, db: "mydb" } });
    expect(getByText("Can't display this script visually — edit it in Script instead.")).toBeTruthy();
    expect(queryByText("Add stage")).toBeNull();
  });

  it("renders one stage card per stage when parsed", () => {
    const tree = fakeTree();
    const { container } = render(PipelineTreeEditor, { props: { tree: tree as never, db: "mydb" } });
    expect(container.querySelectorAll(".stage-card").length).toBe(1);
  });

  it("calls addStage with the selected operator and the end index when Add stage is clicked", async () => {
    const tree = fakeTree();
    const { getByText, container } = render(PipelineTreeEditor, { props: { tree: tree as never, db: "mydb" } });
    const picker = container.querySelector(".add-stage-picker") as HTMLSelectElement;
    await fireEvent.change(picker, { target: { value: "$limit" } });
    await fireEvent.click(getByText("Add stage"));
    expect(tree.addStage).toHaveBeenCalledWith("$limit", 1);
  });

  it("toggles autoPreview via the checkbox", async () => {
    const tree = fakeTree();
    const { getByLabelText } = render(PipelineTreeEditor, { props: { tree: tree as never, db: "mydb" } });
    await fireEvent.click(getByLabelText("Auto preview"));
    expect(tree.setAutoPreview).toHaveBeenCalledWith(false);
  });
});
