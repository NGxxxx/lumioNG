import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import { mergeColumns } from "../domain/schema";
import type { GridPageView } from "../domain/gridView";
import type { Doc } from "../domain/doc";

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
  return {
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
    ...overrides,
  };
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
