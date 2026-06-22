import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import QueryResultGrid from "./QueryResultGrid.svelte";
import { mergeColumns } from "../domain/schema";

const noop = vi.fn();
const noopMenu = () => [];

const baseMenuProps = {
  selected: new Set<number>(),
  menu: null,
  menuItems: noopMenu,
  onRowClick: noop,
  onOpenMenu: noop,
  onMenuSelect: noop,
  onCloseMenu: noop,
};

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
});
