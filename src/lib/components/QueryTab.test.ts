import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

const run = vi.fn();
const stub = {
  get statementText() { return 'db.getCollection("x").aggregate([])'; },
  set statementText(_v: string) {},
  get docs() { return []; }, get columns() { return []; }, get pageDocs() { return []; },
  get colWidths() { return {}; }, get error() { return null; }, get loading() { return false; },
  get capped() { return false; }, get ran() { return false; }, get view() { return "grid"; },
  set view(_v: string) {}, get pageSize() { return 50; }, get currentPage() { return 1; },
  get pageCount() { return 1; }, get totalCount() { return 0; },
  setColWidth: vi.fn(), resetColWidth: vi.fn(), goToPage: vi.fn(), setPageSize: vi.fn(),
  run, runNoLimit: vi.fn(),
};
vi.mock("../stores/queryRuns.svelte", () => ({ getQueryRun: () => stub }));

import QueryTab from "./QueryTab.svelte";

describe("QueryTab", () => {
  const props = { id: 1, seq: 1, initialStatement: "x", currentDb: "shop" };

  it("has no in-tab Run button", () => {
    const { queryByText } = render(QueryTab, { props });
    expect(queryByText("▶ Run")).toBeNull();
  });

  it("right-clicking the editor shows a Run item that runs against the current db", async () => {
    const { container, getByText } = render(QueryTab, { props });
    const editor = container.querySelector("textarea")!;
    await fireEvent.contextMenu(editor);
    await fireEvent.click(getByText("Run"));
    expect(run).toHaveBeenCalledWith("shop");
  });
});
