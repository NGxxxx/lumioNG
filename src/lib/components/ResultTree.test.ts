import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import ResultTree from "./ResultTree.svelte";

describe("ResultTree", () => {
  it("renders the virtual scroller (not the empty hint) when there are docs", () => {
    const docs = [{ _id: { $oid: "aa" } }, { _id: { $oid: "bb" } }];
    const { container } = render(ResultTree, { props: { docs } });
    // Row count is virtualized (depends on viewport, which jsdom reports as 0), so assert the
    // deterministic structure: the scroller + sizer are present and the empty hint is not.
    expect(container.querySelector(".tree-scroller")).toBeTruthy();
    expect(container.querySelector(".tree-sizer")).toBeTruthy();
    expect(container.querySelector(".empty")).toBeNull();
  });

  it("shows an empty hint when there are no docs", () => {
    const { getByText, container } = render(ResultTree, { props: { docs: [] } });
    expect(getByText("No results")).toBeTruthy();
    expect(container.querySelector(".tree-scroller")).toBeNull();
  });
});
