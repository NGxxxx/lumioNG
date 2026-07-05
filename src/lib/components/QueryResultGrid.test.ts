import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import QueryResultGrid from "./QueryResultGrid.svelte";
import { mergeColumns } from "../domain/schema";

// The grid is row-virtualized (see QueryResultGrid.svelte); tanstack-virtual falls back to a
// one-time offsetHeight read when ResizeObserver is unavailable (true in jsdom). Stub a real
// viewport height so these tests see actual rendered rows instead of the virtualizer's
// zero-height default (jsdom always reports 0 for layout properties).
let restoreOffsetHeight: (() => void) | undefined;
beforeAll(() => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  restoreOffsetHeight = () => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
});
afterAll(() => restoreOffsetHeight?.());

const noop = vi.fn();

const baseMenuProps = {
  selected: new Set<number>(),
  onRowClick: noop,
  onOpenMenu: noop,
};

const noop2 = () => {};

const editProps = {
  editing: null as { row: number; key: string } | null,
  editText: "",
  editError: null as string | null,
  onStartEdit: noop2,
  onCommitEdit: noop2,
  onCancelEdit: noop2,
};

describe("QueryResultGrid inline edit", () => {
  it("renders an input when editing matches a cell", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const columns = mergeColumns(null, docs);
    const { container } = render(QueryResultGrid, { props: {
      columns, docs, colWidths: { _id: 160, name: 120 }, onResize: noop, onReset: noop,
      ...baseMenuProps, ...editProps, editing: { row: 0, key: "name" }, editText: "x",
    }});
    expect(container.querySelector("input.celledit")).toBeTruthy();
  });

  it("double-clicking a data cell calls onStartEdit", async () => {
    const onStartEdit = vi.fn();
    const docs = [{ _id: { $oid: "a" }, name: "x" }];
    const columns = mergeColumns(null, docs);
    const { container } = render(QueryResultGrid, { props: {
      columns, docs, colWidths: { _id: 160, name: 120 }, onResize: noop, onReset: noop,
      ...baseMenuProps, ...editProps, onStartEdit,
    }});
    const cells = container.querySelectorAll("td.data-cell"); // [0]=_id, [1]=name
    await fireEvent.dblClick(cells[1]);
    expect(onStartEdit).toHaveBeenCalledWith(0, "name");
  });
});

describe("QueryResultGrid", () => {
  it("renders a header and a row per page doc", () => {
    const docs = [{ _id: { $oid: "a" }, name: "x" }, { _id: { $oid: "b" }, name: "y" }];
    const columns = mergeColumns(null, docs);
    const { getByText, container } = render(QueryResultGrid, {
      props: { columns, docs, colWidths: { _id: 160, name: 120 }, onResize: noop, onReset: noop, ...baseMenuProps },
    });
    expect(getByText("name")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("shows an empty hint when there are no columns", () => {
    const { getByText } = render(QueryResultGrid, {
      props: { columns: [], docs: [], colWidths: {}, onResize: noop, onReset: noop, ...baseMenuProps },
    });
    expect(getByText("No results")).toBeTruthy();
  });

  it("renders far fewer DOM rows than docs for a large result set (virtualized, not one <tr> per doc)", () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({ _id: { $oid: String(i) }, name: `n${i}` }));
    const columns = mergeColumns(null, docs);
    const { container } = render(QueryResultGrid, {
      props: { columns, docs, colWidths: { _id: 160, name: 120 }, onResize: noop, onReset: noop, ...baseMenuProps },
    });
    const rowCount = container.querySelectorAll("tbody tr[data-index]").length;
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThan(100);
  });
});
