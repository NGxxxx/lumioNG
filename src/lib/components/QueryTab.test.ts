import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: null },
}));

const run = vi.fn();
const stub = {
  get statementText() { return 'db.getCollection("x").aggregate([])'; },
  set statementText(_v: string) {},
  get docs() { return []; }, get columns() { return []; }, get pageDocs() { return []; },
  get colWidths() { return {}; }, get error() { return null; }, get running() { return false; },
  get capped() { return false; }, get displayMode() { return "none" as const; },
  get consoleEntries() { return []; }, get ackJson() { return null; }, get valueJson() { return null; },
  get view() { return "grid"; }, set view(_v: string) {},
  get pageSize() { return 50; }, get currentPage() { return 1; },
  get pageCount() { return 1; },
  setColWidth: vi.fn(), resetColWidth: vi.fn(), goToPage: vi.fn(), setPageSize: vi.fn(),
  run, cancel: vi.fn(), setSelection: vi.fn(),
  get hasSelection() { return false; }, runSelection: vi.fn(),
  fieldsFor: vi.fn().mockResolvedValue([]),
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
    const editor = container.querySelector(".editor")!;
    await fireEvent.contextMenu(editor);
    await fireEvent.click(getByText("Run"));
    expect(run).toHaveBeenCalledWith("shop");
  });

  it("shows idle hint when displayMode is none", () => {
    const { getByText } = render(QueryTab, { props });
    expect(getByText(/Edit the statement/)).toBeTruthy();
  });

  it("shows Grid and Console view toggle buttons in the result tab", () => {
    const { getByText } = render(QueryTab, { props });
    expect(getByText("Grid")).toBeTruthy();
    expect(getByText("Console")).toBeTruthy();
  });
});
