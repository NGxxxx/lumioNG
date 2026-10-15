import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ResultGrid from "./ResultGrid.svelte";
import { mergeColumns } from "../domain/schema";
import type { GridPageView } from "../domain/gridView";
import type { Doc } from "../domain/doc";
import { activeDataView, type DataViewHandle } from "../stores/activeDataView.svelte";
import { settings } from "../stores/settings.svelte";
import { gridRowH } from "./gridInteractions.svelte";

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

describe("ResultGrid cell previews", () => {
  it("renders objects as a key/value preview and arrays with their length", () => {
    const docs = [{ _id: { $oid: "a" }, customer: { name: "Lena", tier: "gold" }, items: [{ sku: "S" }, { sku: "T" }] }];
    const columnFields: GridPageView["columnFields"] = [{ path: "customer" }, { path: "items" }];
    const { getByText } = render(ResultGrid, { props: { v: baseView(docs, { columnFields }) } });
    expect(getByText("{ name: Lena, tier: gold }")).toBeTruthy();
    expect(getByText(/^\[2\] /)).toBeTruthy();
  });

  it("shows a dim dash for a missing field, distinct from null", () => {
    const docs = [{ _id: { $oid: "a" }, note: null }, { _id: { $oid: "b" } }];
    const { container } = render(ResultGrid, { props: { v: baseView(docs) } });
    const cells = [...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td:last-child .cell"));
    expect(cells[0]?.textContent).toBe("null");
    expect(cells[1]?.textContent).toBe("—");
    expect(cells[1]?.classList.contains("missing")).toBe(true);
  });

  it("right-aligns numbers", () => {
    const docs = [{ _id: { $oid: "a" }, total: { $numberDecimal: "12.50" } }];
    const { getByText } = render(ResultGrid, { props: { v: baseView(docs) } });
    expect(getByText("12.50").closest("td")?.classList.contains("num")).toBe(true);
  });

  it("ObjectId cells offer a copy button", () => {
    const docs = [{ _id: { $oid: "652f1a9e0000000000000c41" } }];
    const { getByRole } = render(ResultGrid, { props: { v: baseView(docs) } });
    expect(getByRole("button", { name: "Copy" })).toBeTruthy();
  });
});

describe("ResultGrid loading and density", () => {
  it("first load shows 12 skeleton rows and no data rows", () => {
    const { container } = render(ResultGrid, { props: { v: baseView([], { loading: true, columnFields: [{ path: "_id" }] }) } });
    expect(container.querySelectorAll(".skeleton-row").length).toBe(12);
    expect(container.querySelector(".loading-overlay")).toBeNull();
  });

  it("reloading keeps the rows and shows a thin progress bar", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const { container } = render(ResultGrid, { props: { v: baseView(docs, { loading: true }) } });
    expect(container.querySelector(".progress-bar")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr[data-index]").length).toBe(1);
  });

  it("row height follows the density setting", () => {
    settings.setDensity("spacious");
    try {
      const { container } = render(ResultGrid, { props: { v: baseView([{ _id: { $oid: "a" } }]) } });
      expect((container.querySelector(".scroller") as HTMLElement).style.getPropertyValue("--grid-row-h")).toBe("32px");
      expect(gridRowH()).toBe(32);
    } finally {
      settings.setDensity("comfortable");
    }
  });
});

describe("ResultGrid column header menu and pinned columns", () => {
  const docs = [{ _id: { $oid: "a" }, name: "x", n: 1 }];

  it("the header ▾ button opens the column menu and runs the chosen action", async () => {
    const onHeaderMenuSelect = vi.fn();
    const headerMenuItems = vi.fn(() => [{ label: "Pin column", action: "pin" }]);
    const { getAllByRole, getByText } = render(ResultGrid, { props: { v: baseView(docs, { headerMenuItems, onHeaderMenuSelect }) } });
    await fireEvent.click(getAllByRole("button", { name: "Column menu" })[1]);
    expect(headerMenuItems).toHaveBeenCalledWith("name");
    await fireEvent.click(getByText("Pin column"));
    expect(onHeaderMenuSelect).toHaveBeenCalledWith("name", "pin");
  });

  it("no ▾ buttons when the view has no header menu (Query tab)", () => {
    const { queryAllByRole } = render(ResultGrid, { props: { v: baseView(docs) } });
    expect(queryAllByRole("button", { name: "Column menu" })).toHaveLength(0);
  });

  it("pinned columns are sticky with left offsets after the row-number column", () => {
    const v = baseView(docs, { pinned: new Set(["_id"]), colWidths: { _id: 160, name: 120 } });
    const { container } = render(ResultGrid, { props: { v } });
    const th = [...container.querySelectorAll("thead th")].find((t) => t.textContent?.includes("_id")) as HTMLElement;
    expect(th.classList.contains("pinned")).toBe(true);
    expect(th.style.left).toBe("42px");
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

describe("ResultGrid cursor navigation", () => {
  const docs = [0, 1, 2, 3].map((i) => ({ _id: { $oid: String(i) }, n: i }));
  const setup = (over: Partial<GridPageView> = {}, props: Record<string, unknown> = {}) => {
    const setSelected = vi.fn();
    const v = baseView(docs, { setSelected, ...over });
    const r = render(ResultGrid, { props: { v, ...props } });
    const scroller = r.container.querySelector(".scroller") as HTMLElement;
    return { ...r, v, setSelected, scroller };
  };
  const cursorRow = (c: HTMLElement) => [...c.querySelectorAll("tbody tr[data-index]")].findIndex((tr) => tr.classList.contains("row-cursor"));

  it("j moves the cursor down and single-selects that row", async () => {
    const { container, scroller, setSelected } = setup();
    await fireEvent.keyDown(scroller, { key: "j" });
    await fireEvent.keyDown(scroller, { key: "j" });
    expect(cursorRow(container)).toBe(1);
    expect(setSelected).toHaveBeenLastCalledWith(new Set([1]));
  });

  it("ArrowUp from no cursor goes to the last row; k clamps at the top", async () => {
    const { container, scroller } = setup();
    await fireEvent.keyDown(scroller, { key: "ArrowUp" });
    expect(cursorRow(container)).toBe(3);
    for (let i = 0; i < 5; i++) await fireEvent.keyDown(scroller, { key: "k" });
    expect(cursorRow(container)).toBe(0);
  });

  it("Shift+ArrowDown extends the selection from the anchor", async () => {
    const { scroller, setSelected } = setup();
    await fireEvent.keyDown(scroller, { key: "j" });
    await fireEvent.keyDown(scroller, { key: "ArrowDown", shiftKey: true });
    await fireEvent.keyDown(scroller, { key: "ArrowDown", shiftKey: true });
    expect(setSelected).toHaveBeenLastCalledWith(new Set([0, 1, 2]));
  });

  it("x toggles the cursor row and keeps the others", async () => {
    // Live selection, like the real store: setSelected replaces what `selected` returns.
    let sel = new Set([3]);
    const setSelected = vi.fn((rows: Set<number>) => (sel = rows));
    const v = baseView(docs, { setSelected, get selected() { return sel; } });
    const { container } = render(ResultGrid, { props: { v } });
    const scroller = container.querySelector(".scroller") as HTMLElement;
    await fireEvent.click(container.querySelectorAll("tbody tr[data-index]")[0]); // cursor on row 0
    await fireEvent.keyDown(scroller, { key: "x" }); // add 0, keep 3
    expect(sel).toEqual(new Set([3, 0]));
    await fireEvent.keyDown(scroller, { key: "x" }); // remove 0 again
    expect(sel).toEqual(new Set([3]));
  });

  it("End / Home jump to the last / first row", async () => {
    const { container, scroller } = setup();
    await fireEvent.keyDown(scroller, { key: "End" });
    expect(cursorRow(container)).toBe(3);
    await fireEvent.keyDown(scroller, { key: "Home" });
    expect(cursorRow(container)).toBe(0);
  });

  it("[ and ] change page", async () => {
    const { scroller, v } = setup();
    await fireEvent.keyDown(scroller, { key: "]" });
    expect(v.nextPage).toHaveBeenCalled();
    await fireEvent.keyDown(scroller, { key: "[" });
    expect(v.prevPage).toHaveBeenCalled();
  });

  it("Space and e ask to peek the cursor row (view / edit)", async () => {
    const onpeek = vi.fn();
    const { scroller } = setup({}, { onpeek });
    await fireEvent.keyDown(scroller, { key: "j" });
    await fireEvent.keyDown(scroller, { key: " " });
    expect(onpeek).toHaveBeenLastCalledWith(0, false);
    await fireEvent.keyDown(scroller, { key: "e" });
    expect(onpeek).toHaveBeenLastCalledWith(0, true);
  });

  it("Escape first goes to onescape; when not consumed it clears the selection", async () => {
    let consumed = true;
    const onescape = vi.fn(() => consumed);
    const { scroller, setSelected } = setup({ selected: new Set([1]) }, { onescape });
    await fireEvent.keyDown(scroller, { key: "Escape" });
    expect(onescape).toHaveBeenCalled();
    expect(setSelected).not.toHaveBeenCalled();
    consumed = false;
    await fireEvent.keyDown(scroller, { key: "Escape" });
    expect(setSelected).toHaveBeenLastCalledWith(new Set());
  });

  it("/ focuses the search box", async () => {
    const focusSearch = vi.fn();
    const handle = { canEdit: false, canExport: false, canDelete: false, editSelected: vi.fn(), exportCurrent: vi.fn(), deleteSelected: vi.fn(), focusSearch } as DataViewHandle;
    activeDataView.register(handle);
    try {
      const { scroller } = setup();
      await fireEvent.keyDown(scroller, { key: "/" });
      expect(focusSearch).toHaveBeenCalled();
    } finally {
      activeDataView.unregister(handle);
    }
  });

  it("ignores single-letter keys typed into an input inside the grid", async () => {
    const { container, setSelected } = setup({ editing: { row: 0, key: "n", kind: "inline" }, editText: "x" });
    const input = container.querySelector("input.celledit") as HTMLInputElement;
    await fireEvent.keyDown(input, { key: "j" });
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("each row has a Quick look button when onpeek is given", async () => {
    const onpeek = vi.fn();
    const { getAllByRole } = setup({}, { onpeek });
    const buttons = getAllByRole("button", { name: "Quick look" });
    expect(buttons).toHaveLength(4);
    await fireEvent.click(buttons[2]);
    expect(onpeek).toHaveBeenCalledWith(2, false);
  });

  it("the Quick look button also selects its row, so the drawer can't snap back to another selection", async () => {
    const { getAllByRole, setSelected } = setup({ selected: new Set([0]) }, { onpeek: vi.fn() });
    await fireEvent.click(getAllByRole("button", { name: "Quick look" })[2]);
    expect(setSelected).toHaveBeenLastCalledWith(new Set([2]));
  });

  it("no Quick look buttons without onpeek", () => {
    const { queryAllByRole } = setup();
    expect(queryAllByRole("button", { name: "Quick look" })).toHaveLength(0);
  });

  it("Space closes the drawer when it is already open", async () => {
    const onpeek = vi.fn();
    const onpeekclose = vi.fn();
    const { scroller } = setup({}, { onpeek, peekOpen: true, onpeekclose });
    await fireEvent.keyDown(scroller, { key: "j" });
    await fireEvent.keyDown(scroller, { key: " " });
    expect(onpeekclose).toHaveBeenCalled();
    expect(onpeek).not.toHaveBeenCalled();
  });

  it("keys pressed on a focused button inside the grid are left to the button", async () => {
    const onpeek = vi.fn();
    const { getAllByRole, setSelected } = setup({}, { onpeek });
    const eye = getAllByRole("button", { name: "Quick look" })[1];
    await fireEvent.keyDown(eye, { key: " " });
    await fireEvent.keyDown(eye, { key: "j" });
    expect(onpeek).not.toHaveBeenCalled();
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("the cursor resets when a different set of rows is shown (page, filter, sort)", async () => {
    const r = setup();
    await fireEvent.keyDown(r.scroller, { key: "j" });
    expect(cursorRow(r.container)).toBe(0);
    const other = [5, 6].map((i) => ({ _id: { $oid: String(i) }, n: i }));
    await r.rerender({ v: baseView(other, { setSelected: vi.fn(), loadGen: "2" }) });
    expect(cursorRow(r.container)).toBe(-1);
  });

  it("the cursor stays when the same rows are re-assigned (inline edit), even with a changed first row", async () => {
    const r = setup({ loadGen: "1" });
    await fireEvent.keyDown(r.scroller, { key: "j" });
    await fireEvent.keyDown(r.scroller, { key: "j" });
    const edited = r.v.docs.map((d, i) => (i === 0 ? { ...d, _id: { $oid: "edited" } } : d));
    await r.rerender({ v: baseView(edited, { setSelected: vi.fn(), loadGen: "1" }) });
    expect(cursorRow(r.container)).toBe(1);
  });

  it("navigation stays fast with a huge filtered selection", async () => {
    const big = Array.from({ length: 25_000 }, (_, i) => ({ _id: { $oid: String(i) } }));
    const all = big.map((_, i) => i);
    const v = baseView(big, { selected: new Set(all), visibleIndices: all, setSelected: vi.fn() });
    const { container } = render(ResultGrid, { props: { v } });
    const scroller = container.querySelector(".scroller") as HTMLElement;
    const t0 = performance.now();
    await fireEvent.keyDown(scroller, { key: "j", shiftKey: true });
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("a click on empty grid space (not a row) reports onbackground", async () => {
    const onbackground = vi.fn();
    const { scroller, container } = setup({}, { onbackground });
    await fireEvent.click(container.querySelectorAll("tbody tr[data-index]")[0]);
    expect(onbackground).not.toHaveBeenCalled();
    await fireEvent.click(scroller);
    expect(onbackground).toHaveBeenCalled();
  });

  it("clicking a row moves the cursor there", async () => {
    const { container } = setup();
    await fireEvent.click(container.querySelectorAll("tbody tr[data-index]")[2]);
    expect(cursorRow(container)).toBe(2);
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

describe("ResultGrid reference jump", () => {
  const oid = (n: string) => ({ $oid: `652f1a9e00000000000000${n}` });
  const docs = [{ _id: oid("01"), customerId: oid("02"), tagIds: [oid("03")], pair: [oid("04"), oid("05")], name: "x" }];

  it("shows → for ObjectId cells and one-element ObjectId arrays, never for _id; click calls onref", async () => {
    const onref = vi.fn();
    const { container } = render(ResultGrid, { props: { v: baseView(docs), onref } });
    const cells = [...container.querySelectorAll("td.data-cell")];
    const withArrow = cells.filter((c) => c.querySelector(".ref-go")).length;
    expect(withArrow).toBe(2);
    expect(cells[0].querySelector(".ref-go")).toBeNull();
    await fireEvent.click(cells[1].querySelector(".ref-go")!);
    expect(onref).toHaveBeenCalledWith("customerId", oid("02"), expect.objectContaining({ x: expect.any(Number) }));
  });

  it("no onref → no arrows (e.g. results without a session)", () => {
    const { container } = render(ResultGrid, { props: { v: baseView(docs) } });
    expect(container.querySelector(".ref-go")).toBeNull();
  });

  it("g follows the clicked cell's reference, else the row's first one", async () => {
    const onref = vi.fn();
    const { container, getByRole } = render(ResultGrid, { props: { v: baseView(docs), onref } });
    const cells = container.querySelectorAll("td.data-cell");
    await fireEvent.click(cells[4]); // "name" cell: not followable → first reference in the row
    await fireEvent.keyDown(getByRole("grid"), { key: "g" });
    expect(onref).toHaveBeenLastCalledWith("customerId", oid("02"), null);
    await fireEvent.click(cells[2]); // tagIds
    await fireEvent.keyDown(getByRole("grid"), { key: "g" });
    expect(onref).toHaveBeenLastCalledWith("tagIds", oid("03"), null);
  });
});
