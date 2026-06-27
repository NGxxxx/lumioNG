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
  get colWidths() { return {}; }, get error() { return null; }, get loading() { return false; },
  get capped() { return false; }, get ran() { return false; }, get view() { return "grid"; },
  set view(_v: string) {}, get pageSize() { return 50; }, get currentPage() { return 1; },
  get pageCount() { return 1; }, get totalCount() { return 0; },
  setColWidth: vi.fn(), resetColWidth: vi.fn(), goToPage: vi.fn(), setPageSize: vi.fn(),
  run, runNoLimit: vi.fn(), setSelection: vi.fn(),
  get hasSelection() { return false; }, runSelection: vi.fn(),
  fieldsFor: vi.fn().mockResolvedValue([]),
  get srcDb() { return null; }, get srcColl() { return null; },
  onMenuSelect: vi.fn(), get menu() { return null; }, menuItems: vi.fn().mockReturnValue([]),
  get selected() { return null; }, clickRow: vi.fn(), openMenu: vi.fn(), closeMenu: vi.fn(),
  get ioError() { return null; }, get confirmDelete() { return null; },
  get exportRequest() { return null; }, exportInput: vi.fn().mockReturnValue(null),
  cancelExport: vi.fn(), cancelDelete: vi.fn(), confirmDeleteRun: vi.fn(),
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
});
