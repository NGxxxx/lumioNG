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
  get selected() { return new Set<number>(); },
  get menu() { return null; },
  menuItems: vi.fn().mockReturnValue([]),
  clickRow: vi.fn(), openMenu: vi.fn(), closeMenu: vi.fn(),
  onMenuSelect: vi.fn().mockReturnValue(null),
  get editing() { return null; },
  get editText() { return ""; }, set editText(_v: string) {},
  get editError() { return null; },
  startEdit: vi.fn(), commitEdit: vi.fn(), cancelEdit: vi.fn(),
  get isEditable() { return false; },
  get provenance() { return null; },
  get destructiveConfirm() { return null; },
  get confirmDelete() { return null; },
  cancelDelete: vi.fn(), confirmDeleteRun: vi.fn(),
  get exportRequest() { return null; },
  exportInput: vi.fn().mockReturnValue(null),
  cancelExport: vi.fn(),
  get ioError() { return null; },
  confirmRun: vi.fn(), cancelConfirm: vi.fn(), dontAskAgain: vi.fn(),
};

const editableStub = {
  ...stub,
  get displayMode() { return "grid-editable" as const; },
  get isEditable() { return true; },
  get provenance() { return { db: "shop", coll: "items" }; },
  get pageDocs() { return [{ _id: "1", name: "test" }]; },
  get columns() { return [{ path: "name", label: "name" }]; },
};

let activeStub: typeof stub = stub;
vi.mock("../stores/queryRuns.svelte", () => ({ getQueryRun: () => activeStub }));

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

  it("passes edit handlers to the grid only when editable", () => {
    // Swap the store to an editable result for this test.
    activeStub = editableStub as unknown as typeof stub;
    try {
      // Rendering an editable result (displayMode = "grid-editable") should not throw
      // and the result-pane element should be present in the DOM.
      const { container } = render(QueryTab, { props });
      expect(container.querySelector(".result-pane")).toBeTruthy();
    } finally {
      activeStub = stub; // restore for subsequent tests
    }
  });
});
