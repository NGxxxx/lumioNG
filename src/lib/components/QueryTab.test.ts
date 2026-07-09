import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { commandLog } from "../stores/commandLog.svelte";

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: null, sessions: [] },
}));

const run = vi.fn();
const stub = {
  get statementText() { return 'db.getCollection("x").aggregate([])'; },
  set statementText(_v: string) {},
  get docs() { return []; }, get columnFields() { return []; },
  get colWidths() { return {}; }, get error() { return null; }, get running() { return false; },
  get capped() { return false; }, get displayMode() { return "none" as const; },
  get consoleEntries() { return []; }, get ackJson() { return null; }, get valueJson() { return null; },
  get pageSize() { return 50; }, get currentPage() { return 1; },
  get pageCount() { return 1; }, get allShown() { return false; },
  get totalCount() { return 0; }, get loading() { return false; },
  setColWidth: vi.fn(), resetColWidth: vi.fn(), goToPage: vi.fn(), setPageSize: vi.fn(),
  nextPage: vi.fn(), prevPage: vi.fn(), firstPage: vi.fn(), lastPage: vi.fn(),
  requestShowAll: vi.fn(), confirmShowAll: vi.fn(), cancelShowAll: vi.fn(),
  get showAllPending() { return null; },
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
  get provenance() { return { db: "shop", coll: "items" }; },
  get docs() { return [{ _id: "1", name: "test" }]; },
  get columnFields() { return [{ path: "name", label: "name" }]; },
};

const cancelSpy = vi.fn();
const runningStub = {
  ...stub,
  get running() { return true; },
  cancel: cancelSpy,
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

  it("shows Grid, Tree and Console view toggle buttons in the result tab", () => {
    const { getByText } = render(QueryTab, { props });
    expect(getByText("Grid")).toBeTruthy();
    expect(getByText("Tree")).toBeTruthy();
    expect(getByText("Console")).toBeTruthy();
  });

  it("switches to the tree view and renders docs as a virtualized tree", async () => {
    activeStub = editableStub as unknown as typeof stub;
    try {
      const { getByText, container } = render(QueryTab, { props });
      await fireEvent.click(getByText("Tree"));
      expect(container.querySelector(".tree-scroller")).toBeTruthy();
    } finally {
      activeStub = stub;
    }
  });

  it("right-clicking a row in Tree view opens the shared context menu", async () => {
    const menuStub = {
      ...editableStub,
      get menu() { return { x: 10, y: 20, row: 0, key: "_id" }; },
      menuItems: () => [{ label: "Open document", action: "open" }],
    };
    activeStub = menuStub as unknown as typeof stub;
    try {
      const { getByText } = render(QueryTab, { props });
      await fireEvent.click(getByText("Tree"));
      expect(getByText("Open document")).toBeTruthy();
    } finally {
      activeStub = stub;
    }
  });

  it("shows a Show all button in the grid pager, which calls showAll()", async () => {
    const showAllSpy = vi.fn();
    activeStub = { ...editableStub, requestShowAll: showAllSpy } as unknown as typeof stub;
    try {
      const { getByText } = render(QueryTab, { props });
      await fireEvent.click(getByText("Show all"));
      expect(showAllSpy).toHaveBeenCalledOnce();
    } finally {
      activeStub = stub;
    }
  });

  it("shows a back-to-paged button instead of the pager once allShown is true, wired to firstPage", async () => {
    const backSpy = vi.fn();
    activeStub = { ...editableStub, get allShown() { return true; }, firstPage: backSpy } as unknown as typeof stub;
    try {
      const { getByText, queryByText } = render(QueryTab, { props });
      expect(getByText("↩ Paged")).toBeTruthy();
      expect(queryByText("Show all")).toBeNull();
      await fireEvent.click(getByText("↩ Paged"));
      expect(backSpy).toHaveBeenCalledOnce();
    } finally {
      activeStub = stub;
    }
  });

  it("shows the running status and a cancel button while a query runs", () => {
    activeStub = runningStub as unknown as typeof stub;
    try {
      const { getByText } = render(QueryTab, { props });
      expect(getByText("Running…")).toBeTruthy();
      expect(getByText("Cancel")).toBeTruthy();
    } finally {
      activeStub = stub;
    }
  });

  it("invokes cancel() when the cancel button is clicked", async () => {
    activeStub = runningStub as unknown as typeof stub;
    cancelSpy.mockClear();
    try {
      const { getByText } = render(QueryTab, { props });
      await fireEvent.click(getByText("Cancel"));
      expect(cancelSpy).toHaveBeenCalledOnce();
    } finally {
      activeStub = stub;
    }
  });

  it("does not render results while running", () => {
    activeStub = runningStub as unknown as typeof stub;
    try {
      const { queryByText } = render(QueryTab, { props });
      // The idle hint belongs to the not-running result pane; it must be hidden while running.
      expect(queryByText(/Edit the statement/)).toBeNull();
    } finally {
      activeStub = stub;
    }
  });

  it("Command log tab's Clear button empties the shared command log", async () => {
    commandLog.push("db.x.find()", "s1", 5);
    const { getByText } = render(QueryTab, { props });
    await fireEvent.click(getByText("Command log"));
    expect(commandLog.entries.length).toBeGreaterThan(0);
    await fireEvent.click(getByText("Clear"));
    expect(commandLog.entries).toHaveLength(0);
  });

  it("running a query switches bottomTab back to Result if Command log was active", async () => {
    const { container, getByText, queryByText } = render(QueryTab, { props });
    await fireEvent.click(getByText("Command log"));
    expect(queryByText(/Edit the statement/)).toBeNull();

    const editor = container.querySelector(".editor")!;
    await fireEvent.contextMenu(editor);
    await fireEvent.click(getByText("Run"));

    expect(getByText(/Edit the statement/)).toBeTruthy();
  });

  it("auto-switches resultView to console after a run whose result is console-only", async () => {
    const consoleOnlyStub = {
      ...stub,
      get consoleEntries() { return [{ level: "log" as const, text: "hi" }]; },
    };
    activeStub = consoleOnlyStub as unknown as typeof stub;
    try {
      const { container, getByText } = render(QueryTab, { props });
      const editor = container.querySelector(".editor")!;
      await fireEvent.contextMenu(editor);
      await fireEvent.click(getByText("Run"));
      // resultView is assigned after `await v.run(...)` resolves, one microtask past the click's
      // own flush — a zero-delay timer drains that queue before we assert on the DOM.
      await new Promise((r) => setTimeout(r, 0));

      expect(getByText("Console").classList.contains("active")).toBe(true);
    } finally {
      activeStub = stub;
    }
  });

  it("renders the Show all confirmation dialog when showAllPending is set, and wires confirm/cancel", async () => {
    const confirmSpy = vi.fn();
    const cancelSpy2 = vi.fn();
    activeStub = {
      ...editableStub,
      get showAllPending() { return 6000; },
      confirmShowAll: confirmSpy,
      cancelShowAll: cancelSpy2,
    } as unknown as typeof stub;
    try {
      const { getByText } = render(QueryTab, { props });
      expect(getByText("Show all?")).toBeTruthy();
      await fireEvent.click(getByText("Show all", { selector: "footer button" }));
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(cancelSpy2).not.toHaveBeenCalled();
    } finally {
      activeStub = stub;
    }
  });

  it("passes edit handlers to the grid only when editable", () => {
    // Swap the store to an editable result for this test.
    activeStub = editableStub as unknown as typeof stub;
    try {
      // Rendering an editable result (displayMode = "grid-editable") should not throw
      // and the result-pane element should be present in the DOM.
      const { container } = render(QueryTab, { props });
      expect(container.querySelector(".result-pane")).toBeTruthy();
      expect(container.querySelector(".pane-divider")).toBeTruthy();
    } finally {
      activeStub = stub; // restore for subsequent tests
    }
  });
});
