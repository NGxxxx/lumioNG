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

  it("defaults to depth-1 expanded, and collapseAll/expandAll change the virtual row count", async () => {
    // 2 docs × 2 non-_id fields → collapsed 2 rows, depth-1-expanded (the default) 6 rows.
    // Sizer height = rows × ROW_EST.
    const docs = [
      { _id: { $oid: "aa" }, a: 1, b: 2 },
      { _id: { $oid: "bb" }, a: 1, b: 2 },
    ];
    const { container, component } = render(ResultTree, { props: { docs } });
    const sizer = () => container.querySelector<HTMLDivElement>(".tree-sizer")!;
    const expanded = parseInt(sizer().style.height);
    component.collapseAll();
    await tick();
    const collapsed = parseInt(sizer().style.height);
    expect(expanded).toBe(collapsed * 3);
    component.expandAll();
    await tick();
    expect(parseInt(sizer().style.height)).toBe(expanded);
  });
});

describe("ResultTree reference jump", () => {
  it("→ on ObjectId leaves (not the doc's _id) calls onref with the field path", async () => {
    const { fireEvent } = await import("@testing-library/svelte");
    const { vi } = await import("vitest");
    const oid = { $oid: "652f1a9e0000000000000c41" };
    const onref = vi.fn();
    // The tree is virtualized: give elements a height so jsdom renders rows.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    const { container } = render(ResultTree, { props: { docs: [{ _id: oid, customerId: oid, name: "x" }], onref } });
    await tick();
    if (desc) Object.defineProperty(HTMLElement.prototype, "offsetHeight", desc);
    const arrows = container.querySelectorAll(".tree-ref");
    expect(arrows).toHaveLength(1);
    await fireEvent.click(arrows[0]);
    expect(onref).toHaveBeenCalledWith("customerId", oid, expect.anything());
  });
});
