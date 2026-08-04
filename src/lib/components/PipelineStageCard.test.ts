import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { flushSync } from "svelte";
import PipelineStageCard from "./PipelineStageCard.svelte";
import type { StageEntry } from "../domain/pipelineStages";

vi.mock("../stores/fieldSuggestions", () => ({
  fieldsFor: vi.fn(async () => ["status", "customer"]),
}));

import { fieldsFor } from "../stores/fieldSuggestions";
const fieldsForMock = fieldsFor as ReturnType<typeof vi.fn>;

// TreeEditor's virtualizer needs a non-zero container size to mount any rows (jsdom is 0 by default).
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

function fakeTree(stages: StageEntry[]) {
  return {
    stages,
    coll: "orders",
    sessionId: "sess1",
    autoPreview: true,
    hasClipboard: false,
    previewFor: vi.fn(() => ({ docs: [], loading: false, error: null, hasRun: false })),
    updateStageBody: vi.fn(),
    renameStage: vi.fn(),
    removeStage: vi.fn(),
    reorderStage: vi.fn(),
    requestPreview: vi.fn(),
    runPreview: vi.fn(),
    cutStage: vi.fn(),
    copyStage: vi.fn(),
    pasteStageAfter: vi.fn(),
    duplicateStage: vi.fn(),
  };
}

describe("PipelineStageCard", () => {
  // fieldsForMock is a shared vi.fn() across every test in this file; without clearing, a later
  // test's toHaveBeenCalledTimes() assertion would count calls from earlier tests' mounts too.
  beforeEach(() => fieldsForMock.mockClear());

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

  it("changing the operator with a non-default body shows a confirm dialog before renaming", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { status: "shipped" } }]);
    const { container, getByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    const select = container.querySelector("select.stage-name") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "$limit" } });
    expect(tree.renameStage).not.toHaveBeenCalled();
    await fireEvent.click(getByText("Change stage type"));
    expect(tree.renameStage).toHaveBeenCalledWith(0, "$limit");
  });

  it("changing the operator with a still-default body renames immediately, no confirm dialog", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]); // {} is $match's own default body
    const { container, queryByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    const select = container.querySelector("select.stage-name") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "$limit" } });
    expect(tree.renameStage).toHaveBeenCalledWith(0, "$limit");
    expect(queryByText("Change stage type")).toBeNull();
  });

  it("cancelling the confirm dialog does not rename and reverts the select to the current operator", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { status: "shipped" } }]);
    const { container, getByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    const select = container.querySelector("select.stage-name") as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: "$limit" } });
    await fireEvent.click(getByText("Cancel"));
    expect(tree.renameStage).not.toHaveBeenCalled();
    expect(select.value).toBe("$match");
  });

  it("draggable starts only from the drag handle, not the whole card", () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]);
    const { container } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    expect(container.querySelector(".stage-card")?.getAttribute("draggable")).toBeNull();
    expect(container.querySelector(".drag-handle")?.getAttribute("draggable")).toBe("true");
  });

  it("fetches field suggestions for the stage's collection and forwards them to TreeEditor", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { a: 1 } }]);
    render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    await waitFor(() => expect(fieldsForMock).toHaveBeenCalledWith("sess1", "mydb", "orders"));
  });

  it("discards a stale fieldSuggestions response that resolves after a fresher one (e.g. db switched quickly)", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: { a: 1 } }]);
    let resolveFirst!: (f: string[]) => void;
    let resolveSecond!: (f: string[]) => void;
    fieldsForMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { container, rerender } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    await rerender({ tree: tree as never, index: 0, db: "otherdb" });
    flushSync();

    // Second (fresher) call's response — for the newer db — arrives first.
    resolveSecond(["fresh"]);
    await waitFor(() => expect(fieldsForMock).toHaveBeenCalledTimes(2));

    // ...then the stale first call's response arrives late — it must not overwrite the fresher one.
    resolveFirst(["stale"]);
    await new Promise((r) => setTimeout(r, 0));

    const input = container.querySelector("input.name") as HTMLInputElement;
    await fireEvent.focus(input);
    const options = Array.from(container.querySelectorAll(".suggest-option .suggest-label")).map((o) => o.textContent);
    // "stale" never appears; "fresh" is followed by this $match stage's own depth-0 operator
    // suggestions ($and/$or/$nor/$expr), now wired in via operatorSuggestionsFor.
    expect(options).toEqual(["fresh", "$and", "$or", "$nor", "$expr"]);
  });

  it("right-clicking the stage header opens a context menu with Cut/Copy/Duplicate/Delete but no Paste when the clipboard is empty", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]);
    const { container, getByText, queryByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    expect(getByText("Cut stage")).toBeTruthy();
    expect(getByText("Copy stage")).toBeTruthy();
    expect(getByText("Duplicate stage")).toBeTruthy();
    expect(getByText("Delete stage")).toBeTruthy();
    expect(queryByText("Paste stage")).toBeNull();
  });

  it("shows Paste stage when the clipboard has something", async () => {
    const tree = fakeTree([{ id: "s1", name: "$match", body: {} }]);
    (tree as { hasClipboard: boolean }).hasClipboard = true;
    const { container, getByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 0, db: "mydb" } });
    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    expect(getByText("Paste stage")).toBeTruthy();
  });

  it("Cut/Copy/Duplicate/Delete menu items call the matching store method with this card's index", async () => {
    // 3 stages so index 2 is valid — PipelineStageCard derives `stage` from tree.stages[index].
    const tree = fakeTree([
      { id: "s1", name: "$match", body: {} },
      { id: "s2", name: "$match", body: {} },
      { id: "s3", name: "$match", body: {} },
    ]);
    const { container, getByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 2, db: "mydb" } });

    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    await fireEvent.click(getByText("Cut stage"));
    expect(tree.cutStage).toHaveBeenCalledWith(2);

    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    await fireEvent.click(getByText("Copy stage"));
    expect(tree.copyStage).toHaveBeenCalledWith(2);

    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    await fireEvent.click(getByText("Duplicate stage"));
    expect(tree.duplicateStage).toHaveBeenCalledWith(2);

    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    await fireEvent.click(getByText("Delete stage"));
    expect(tree.removeStage).toHaveBeenCalledWith(2);
  });

  it("Paste stage menu item calls pasteStageAfter with this card's index", async () => {
    // 2 stages so index 1 is valid — PipelineStageCard derives `stage` from tree.stages[index].
    const tree = fakeTree([
      { id: "s1", name: "$match", body: {} },
      { id: "s2", name: "$match", body: {} },
    ]);
    (tree as { hasClipboard: boolean }).hasClipboard = true;
    const { container, getByText } = render(PipelineStageCard, { props: { tree: tree as never, index: 1, db: "mydb" } });
    await fireEvent.contextMenu(container.querySelector(".stage-head")!);
    await fireEvent.click(getByText("Paste stage"));
    expect(tree.pasteStageAfter).toHaveBeenCalledWith(1);
  });
});
