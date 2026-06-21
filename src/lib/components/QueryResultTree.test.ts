import { describe, it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import QueryResultTree from "./QueryResultTree.svelte";

describe("QueryResultTree", () => {
  it("renders one collapsed doc header per result", () => {
    const docs = [{ _id: { $oid: "aa" } }, { _id: { $oid: "bb" } }];
    const { container } = render(QueryResultTree, { props: { docs } });
    expect(container.querySelectorAll(".tree-doc").length).toBe(2);
  });

  it("shows an empty hint when there are no docs", () => {
    const { getByText } = render(QueryResultTree, { props: { docs: [] } });
    expect(getByText("No results")).toBeTruthy();
  });
});
