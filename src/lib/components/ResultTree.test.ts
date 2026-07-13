import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import ResultTree from "./ResultTree.svelte";

describe("ResultTree", () => {
  it("renders the virtual scroller (not the empty hint) when there are docs", () => {
    const docs = [{ _id: { $oid: "aa" } }, { _id: { $oid: "bb" } }];
    const { container } = render(ResultTree, { props: { docs } });
    // Row count is virtualized (jsdom viewport is 0), so assert deterministic structure only.
    expect(container.querySelector(".tree-scroller")).toBeTruthy();
    expect(container.querySelector(".tree-sizer")).toBeTruthy();
    expect(container.querySelector(".empty")).toBeNull();
  });

  it("shows an empty hint when there are no docs", () => {
    const { getByText, container } = render(ResultTree, { props: { docs: [] } });
    expect(getByText("No results")).toBeTruthy();
    expect(container.querySelector(".tree-scroller")).toBeNull();
  });

  it("expandAll/collapseAll change the virtual row count (sizer height)", async () => {
    // 2 docs × 2 non-_id fields → collapsed 2 rows, expanded 6 rows. Sizer height = rows × ROW_EST.
    const docs = [
      { _id: { $oid: "aa" }, a: 1, b: 2 },
      { _id: { $oid: "bb" }, a: 1, b: 2 },
    ];
    const { container, component } = render(ResultTree, { props: { docs } });
    const sizer = () => container.querySelector<HTMLDivElement>(".tree-sizer")!;
    const collapsed = parseInt(sizer().style.height);
    component.expandAll();
    await tick();
    expect(parseInt(sizer().style.height)).toBe(collapsed * 3);
    component.collapseAll();
    await tick();
    expect(parseInt(sizer().style.height)).toBe(collapsed);
  });
});
