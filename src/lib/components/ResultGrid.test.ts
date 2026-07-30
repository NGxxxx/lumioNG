import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import { mergeColumns } from "../domain/schema";
import type { GridPageView } from "../domain/gridView";
import type { Doc } from "../domain/doc";
import { activeDataView, type DataViewHandle } from "../stores/activeDataView.svelte";

let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

function baseView(docs: Doc[], overrides: Partial<GridPageView> = {}): GridPageView {
  const base = {
    docs,
    visibleIndices: null,
    columnFields: mergeColumns(null, docs),
    colWidths: { _id: 160, name: 120 },
    setColWidth: vi.fn(), resetColWidth: vi.fn(),
    currentPage: 1, pageCount: 1, totalCount: docs.length, pageSize: 50, allShown: false, loading: false,
    goToPage: vi.fn(), nextPage: vi.fn(), prevPage: vi.fn(), firstPage: vi.fn(), lastPage: vi.fn(),
    setPageSize: vi.fn(), requestShowAll: vi.fn(),
    selected: new Set<number>(), clickRow: vi.fn(), menu: null, openMenu: vi.fn(), closeMenu: vi.fn(),
    menuItems: () => [],
    editing: null, editText: "", editTextLoading: false, editError: null, saving: false,
    startEdit: vi.fn(), commitEdit: vi.fn(), cancelEdit: vi.fn(), onEditBlur: vi.fn(),
  };
  // Merge via property descriptors (not a plain `...overrides` spread) so that a `get editing()`
  // accessor in `overrides` stays a live getter on the returned view — a plain spread would read
  // it once and flatten it into a static value, breaking tests that mutate the backing variable
  // after render to simulate the store clearing `editing` on a successful commit.
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides)) as GridPageView;
}

describe("ResultGrid inline edit", () => {
  it("renders an input when editing matches a cell", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, { editing: { row: 0, key: "name", kind: "inline" }, editText: "x" });
    const { container } = render(ResultGrid, { props: { v } });
    expect(container.querySelector("input.celledit")).toBeTruthy();
  });

  it("double-clicking a data cell calls startEdit", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs);
    const { container } = render(ResultGrid, { props: { v } });
    const cells = container.querySelectorAll("td.data-cell"); // [0]=_id, [1]=name
    await fireEvent.dblClick(cells[1]);
    expect(v.startEdit).toHaveBeenCalledWith(0, "name");
  });

  it("renders the modal editor (not an inline input) when editing.kind is 'modal'", () => {
    const docs = [{ _id: { $oid: "a" }, tags: ["x", "y"] }];
    const v = baseView(docs, { editing: { row: 0, key: "tags", kind: "modal" }, editText: '["x","y"]' });
    const { container } = render(ResultGrid, { props: { v } });
    expect(container.querySelector("input.celledit")).toBeNull();
    // The modal is moved to document.body via the `portal` action, not a descendant of `container`.
    expect(document.querySelector(".modal-editor textarea.modal-textarea")).toBeTruthy();
  });

  it("modal editor's Save button calls commitEdit", async () => {
    const docs = [{ _id: { $oid: "a" }, tags: ["x"] }];
    const v = baseView(docs, { editing: { row: 0, key: "tags", kind: "modal" }, editText: '["x"]' });
    const { getByText } = render(ResultGrid, { props: { v } });
    await fireEvent.click(getByText("Save"));
    expect(v.commitEdit).toHaveBeenCalled();
  });
});

describe("ResultGrid", () => {
  it("renders a header and a row per page doc", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }, { _id: { $oid: "b" }, name: "y" }];
    const v = baseView(docs);
    const { getByText, container } = render(ResultGrid, { props: { v } });
    expect(getByText("name")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("shows an empty hint when there are no columns", () => {
    const v = baseView([]);
    const { getByText } = render(ResultGrid, { props: { v } });
    expect(getByText("No results")).toBeTruthy();
  });

  it("renders far fewer DOM rows than docs for a large result set (virtualized)", () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({ _id: { $oid: String(i) }, name: `n${i}` }));
    const v = baseView(docs);
    const { container } = render(ResultGrid, { props: { v } });
    const rowCount = container.querySelectorAll("tbody tr[data-index]").length;
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThan(100);
  });

  it("hides the sort-header affordance when the view has no toggleSort (Query tab)", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs); // no sortKeys/toggleSort
    const { container } = render(ResultGrid, { props: { v } });
    expect(container.querySelector(".sortarrow")).toBeNull();
  });

  it("shows the sort-header affordance when the view provides toggleSort (Collection tab)", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, {
      sortKeys: [{ path: "name", dir: 1 }],
      toggleSort: vi.fn(),
    });
    const { container } = render(ResultGrid, { props: { v } });
    expect(container.querySelector(".sortarrow")).toBeTruthy();
  });
});

describe("ResultGrid keyboard shortcuts", () => {
  it("Ctrl+I calls invertSelection", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, { invertSelection: vi.fn() });
    const { container } = render(ResultGrid, { props: { v } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "i", ctrlKey: true });
    expect(v.invertSelection).toHaveBeenCalled();
  });

  it("Ctrl+C calls copySelectedAsJson", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, { copySelectedAsJson: vi.fn() });
    const { container } = render(ResultGrid, { props: { v } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "c", ctrlKey: true });
    expect(v.copySelectedAsJson).toHaveBeenCalled();
  });

  it("Ctrl+C while inline-editing does not call copySelectedAsJson", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, {
      editing: { row: 0, key: "name", kind: "inline" },
      editText: "x",
      copySelectedAsJson: vi.fn(),
    });
    const { container } = render(ResultGrid, { props: { v } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "c", ctrlKey: true });
    expect(v.copySelectedAsJson).not.toHaveBeenCalled();
  });

  it("Ctrl+F focuses the active data view's search box", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs);
    const focusSearch = vi.fn();
    const handle = { canEdit: false, canExport: true, canDelete: false, editSelected: vi.fn(), exportCurrent: vi.fn(), deleteSelected: vi.fn(), focusSearch } as unknown as DataViewHandle;
    activeDataView.register(handle);
    try {
      const { container } = render(ResultGrid, { props: { v } });
      await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "f", ctrlKey: true });
      expect(focusSearch).toHaveBeenCalled();
    } finally {
      activeDataView.unregister(handle);
    }
  });

  it("F2 calls the active data view's editSelected", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs);
    const editSelected = vi.fn();
    const handle = { canEdit: true, canExport: true, canDelete: false, editSelected, exportCurrent: vi.fn(), deleteSelected: vi.fn() } as unknown as DataViewHandle;
    activeDataView.register(handle);
    try {
      const { container } = render(ResultGrid, { props: { v } });
      await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "F2" });
      expect(editSelected).toHaveBeenCalled();
    } finally {
      activeDataView.unregister(handle);
    }
  });

  it("Ctrl+Delete calls requestDeleteSelected", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, { requestDeleteSelected: vi.fn() });
    const { container } = render(ResultGrid, { props: { v } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "Delete", ctrlKey: true });
    expect(v.requestDeleteSelected).toHaveBeenCalled();
  });

  it("Insert calls newDocument and forwards the result via onopendocument", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const newDoc = { name: "" };
    const v = baseView(docs, { newDocument: vi.fn().mockReturnValue(newDoc) });
    const onopendocument = vi.fn();
    const { container } = render(ResultGrid, { props: { v, onopendocument } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "Insert" });
    expect(v.newDocument).toHaveBeenCalled();
    expect(onopendocument).toHaveBeenCalledWith(newDoc, "insert");
  });

  it("Ctrl+Insert calls duplicateSelected and forwards a non-null result via onopendocument", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const dupDoc = { name: "x" };
    const v = baseView(docs, { duplicateSelected: vi.fn().mockReturnValue(dupDoc) });
    const onopendocument = vi.fn();
    const { container } = render(ResultGrid, { props: { v, onopendocument } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "Insert", ctrlKey: true });
    expect(v.duplicateSelected).toHaveBeenCalled();
    expect(onopendocument).toHaveBeenCalledWith(dupDoc, "insert");
  });

  it("Ctrl+Insert does nothing when duplicateSelected returns null", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs, { duplicateSelected: vi.fn().mockReturnValue(null) });
    const onopendocument = vi.fn();
    const { container } = render(ResultGrid, { props: { v, onopendocument } });
    await fireEvent.keyDown(container.querySelector(".scroller")!, { key: "Insert", ctrlKey: true });
    expect(onopendocument).not.toHaveBeenCalled();
  });

  it("Insert/Ctrl+Insert/Ctrl+I/Ctrl+C/Ctrl+Delete no-op when the view doesn't implement them (Query tab grid)", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const v = baseView(docs); // none of the new optional methods provided
    const { container } = render(ResultGrid, { props: { v } });
    const scroller = container.querySelector(".scroller")!;
    // None of these should throw.
    await fireEvent.keyDown(scroller, { key: "Insert" });
    await fireEvent.keyDown(scroller, { key: "Insert", ctrlKey: true });
    await fireEvent.keyDown(scroller, { key: "i", ctrlKey: true });
    await fireEvent.keyDown(scroller, { key: "c", ctrlKey: true });
    await fireEvent.keyDown(scroller, { key: "Delete", ctrlKey: true });
  });
});

describe("ResultGrid cell-edit keyboard", () => {
  it("Ctrl+Enter commits and stays on the same cell", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }, { _id: { $oid: "b" }, name: "y" }];
    const v = baseView(docs, {
      editing: { row: 0, key: "name", kind: "inline" },
      editText: "x",
      commitEdit: vi.fn(),
      startEdit: vi.fn(),
    });
    const { container } = render(ResultGrid, { props: { v } });
    const input = container.querySelector("input.celledit")!;
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(v.commitEdit).toHaveBeenCalled();
    expect(v.startEdit).not.toHaveBeenCalled();
  });

  // Both real stores (collectionView.svelte.ts, queryScript.svelte.ts) clear `editing` only
  // AFTER an internal `await` inside `commitEdit` — never synchronously as part of the call.
  // The mock below reproduces that exact timing (an `await` happens *before* the mutation) so
  // that a caller which reads `v.editing` right after calling `v.commitEdit()` without awaiting
  // it observes the stale (still non-null) value, matching production behavior.
  async function flushMicrotasks() {
    // A handful of microtask hops is enough to drain the commitEdit → commitAndAdvance await
    // chain; using a real macrotask boundary would also work but this matches the lighter-weight
    // `await Promise.resolve()` flush already used elsewhere in this codebase (QueryTab.test.ts).
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  it("bare Enter commits, then starts editing the next row's same column", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }, { _id: { $oid: "b" }, name: "y" }];
    let editingNow: { row: number; key: string; kind: "inline" | "modal" } | null = { row: 0, key: "name", kind: "inline" };
    const commitEdit = vi.fn().mockImplementation(async () => {
      await Promise.resolve(); // real store: at least one await happens before `editing` clears
      editingNow = null; // mirrors the real store: a successful commit clears `editing`
    });
    const startEdit = vi.fn();
    const v = baseView(docs, {
      get editing() { return editingNow; },
      editText: "x",
      commitEdit,
      startEdit,
    });
    const { container } = render(ResultGrid, { props: { v } });
    const input = container.querySelector("input.celledit")!;
    await fireEvent.keyDown(input, { key: "Enter" });
    await flushMicrotasks();
    expect(commitEdit).toHaveBeenCalled();
    expect(startEdit).toHaveBeenCalledWith(1, "name");
  });

  it("bare Enter on the last row commits and does not call startEdit again", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    let editingNow: { row: number; key: string; kind: "inline" | "modal" } | null = { row: 0, key: "name", kind: "inline" };
    const commitEdit = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      editingNow = null;
    });
    const startEdit = vi.fn();
    const v = baseView(docs, {
      get editing() { return editingNow; },
      editText: "x",
      commitEdit,
      startEdit,
    });
    const { container } = render(ResultGrid, { props: { v } });
    const input = container.querySelector("input.celledit")!;
    await fireEvent.keyDown(input, { key: "Enter" });
    await flushMicrotasks();
    expect(commitEdit).toHaveBeenCalled();
    expect(startEdit).not.toHaveBeenCalled();
  });

  it("bare Enter does not advance when commitEdit fails (editError set, editing unchanged)", async () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }, { _id: { $oid: "b" }, name: "y" }];
    const editingNow = { row: 0, key: "name", kind: "inline" as const };
    const commitEdit = vi.fn().mockImplementation(async () => {
      await Promise.resolve(); // does NOT clear editing — simulates a validation/save failure
    });
    const startEdit = vi.fn();
    const v = baseView(docs, { editing: editingNow, editText: "bad", commitEdit, startEdit });
    const { container } = render(ResultGrid, { props: { v } });
    const input = container.querySelector("input.celledit")!;
    await fireEvent.keyDown(input, { key: "Enter" });
    await flushMicrotasks();
    expect(commitEdit).toHaveBeenCalled();
    expect(startEdit).not.toHaveBeenCalled();
  });
});

describe("ResultGrid quick-search index mapping", () => {
  const docs = [
    { _id: { $oid: "a" }, name: "Alpha" },
    { _id: { $oid: "b" }, name: "Beta" },
    { _id: { $oid: "c" }, name: "Gamma" },
  ];

  it("renders only the visibleIndices rows, skipping filtered-out ones", () => {
    const v = baseView(docs, { visibleIndices: [0, 2] });
    const { container } = render(ResultGrid, { props: { v } });
    const rows = container.querySelectorAll("tbody tr[data-index]");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("Alpha");
    expect(rows[1].textContent).toContain("Gamma");
  });

  it("clicking a filtered row calls clickRow with the real index into docs, not the display position", async () => {
    const v = baseView(docs, { visibleIndices: [0, 2] });
    const { container } = render(ResultGrid, { props: { v } });
    const rows = container.querySelectorAll("tbody tr[data-index]");
    await fireEvent.click(rows[1]); // second rendered row is docs[2] ("Gamma")
    expect(v.clickRow).toHaveBeenCalledWith(2, { ctrl: false, shift: false });
  });

  it("renders every row when visibleIndices is null", () => {
    const v = baseView(docs, { visibleIndices: null });
    const { container } = render(ResultGrid, { props: { v } });
    expect(container.querySelectorAll("tbody tr[data-index]").length).toBe(3);
  });

  it("highlights the correct doc's row when a pre-existing selection survives an active filter", () => {
    // docs[2] ("Gamma") was selected before the search was applied; the filter now hides
    // docs[1] ("Beta"), but selection is keyed on the real docs index, so it must still
    // resolve to the row that is actually "Gamma", not whichever row happens to render second.
    const v = baseView(docs, { visibleIndices: [0, 2], selected: new Set([2]) });
    const { container } = render(ResultGrid, { props: { v } });
    const rows = container.querySelectorAll("tbody tr[data-index]");
    expect(rows.length).toBe(2);
    expect(rows[0].classList.contains("row-selected")).toBe(false); // "Alpha", index 0
    expect(rows[1].classList.contains("row-selected")).toBe(true); // "Gamma", index 2
    expect(rows[1].textContent).toContain("Gamma");
  });
});
