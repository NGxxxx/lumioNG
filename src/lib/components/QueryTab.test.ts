import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/svelte";
import { commandLog } from "../stores/commandLog.svelte";
import { activeDataView } from "../stores/activeDataView.svelte";

vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: null, sessions: [] },
}));

const run = vi.fn();
const stub = {
  get statementText() { return 'db.getCollection("x").aggregate([])'; },
  set statementText(_v: string) {},
  get docs() { return []; }, get visibleIndices() { return null; }, get columnFields() { return []; },
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
  fullDocFor: async (d: unknown) => d, setSelected: vi.fn(), replaceDoc: vi.fn(),
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
  get searchTerm() { return ""; }, set searchTerm(_v: string) {},
  get searchInvalid() { return false; },
  startEdit: vi.fn(), commitEdit: vi.fn(), cancelEdit: vi.fn(),
  get provenance() { return null; },
  get destructiveConfirm() { return null; },
  get criticalConfirm() { return null; },
  get destructive() { return { pending: null, running: false, error: null, request: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }; },
  get exportRequest() { return null; },
  exportInput: vi.fn().mockReturnValue(null),
  cancelExport: vi.fn(),
  get ioError() { return null; },
  confirmRun: vi.fn(), cancelConfirm: vi.fn(), dontAskAgain: vi.fn(),
  confirmCritical: vi.fn(), cancelCritical: vi.fn(),
  get canExplain() { return false; },
  get explainSummary() { return null; },
  get explainRawJson() { return null; },
  get explainPrevSummary() { return null; },
  get explainLoading() { return false; },
  get explainError() { return null; },
  get indexSuggestion() { return null; },
  get explainRequestSeq() { return 0; },
  ensureExplain: vi.fn(), runExplain: vi.fn(), createSuggestedIndex: vi.fn(),
  explainAfterRun: vi.fn(),
  get sessionId() { return "sess1"; },
  get pendingSessionSwitch() { return null; },
  confirmSessionSwitch: vi.fn(), cancelSessionSwitch: vi.fn(),
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
const stubsById = new Map<number, typeof stub>();
vi.mock("../stores/queryRuns.svelte", () => ({
  getQueryRun: (id: number) => stubsById.get(id) ?? activeStub,
}));

import QueryTab from "./QueryTab.svelte";

describe("QueryTab", () => {
  const props = { id: 1, seq: 1, initialStatement: "x", sessionId: "sess1", currentDb: "shop", active: true };

  it("title row Run button runs against the current db and session", async () => {
    run.mockClear();
    const { getByRole } = render(QueryTab, { props });
    await fireEvent.click(getByRole("button", { name: "Run query" }));
    expect(run).toHaveBeenCalledWith("shop", "sess1");
  });

  it("title row Stop is disabled while idle and cancels while running", async () => {
    activeStub = stub;
    const idle = render(QueryTab, { props });
    expect((idle.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
    idle.unmount();
    activeStub = runningStub as unknown as typeof stub;
    try {
      const { getByRole } = render(QueryTab, { props });
      await fireEvent.click(getByRole("button", { name: "Stop" }));
      expect(cancelSpy).toHaveBeenCalled();
    } finally {
      activeStub = stub;
    }
  });

  it("title row Save calls onsave; Run selection is disabled without a selection", async () => {
    const onsave = vi.fn();
    const { getByRole } = render(QueryTab, { props: { ...props, onsave } });
    expect((getByRole("button", { name: "Run selection" }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByRole("button", { name: "Save" }));
    expect(onsave).toHaveBeenCalled();
  });

  it("right-clicking the editor shows a Run item that runs against the current db and session", async () => {
    const { container, getByText } = render(QueryTab, { props });
    const editor = container.querySelector(".editor")!;
    await fireEvent.contextMenu(editor);
    await fireEvent.click(getByText("Run"));
    expect(run).toHaveBeenCalledWith("shop", "sess1");
  });

  it("right-click menu's Explain item delegates to the store's explainAfterRun with the current db and session (run-if-needed + view-switch live inside the store)", async () => {
    const explainAfterRunSpy = vi.fn();
    activeStub = { ...stub, explainAfterRun: explainAfterRunSpy } as unknown as typeof stub;
    try {
      const { container, getByText } = render(QueryTab, { props });
      const editor = container.querySelector(".editor")!;
      await fireEvent.contextMenu(editor);
      await fireEvent.click(getByText("Explain"));
      expect(explainAfterRunSpy).toHaveBeenCalledWith("shop", "sess1");
    } finally {
      activeStub = stub;
    }
  });

  it("right-click → Insert template appends a statement for the editor's collection", async () => {
    const setText = vi.fn();
    activeStub = { ...stub, get statementText() { return 'db.getCollection("x").aggregate([])'; }, set statementText(t: string) { setText(t); } } as unknown as typeof stub;
    try {
      const { container, getByText } = render(QueryTab, { props });
      await fireEvent.contextMenu(container.querySelector(".editor")!);
      await fireEvent.click(getByText("Insert template"));
      await fireEvent.click(getByText("Distinct values of a field"));
      expect(setText).toHaveBeenLastCalledWith('db.getCollection("x").aggregate([])\n\ndb.getCollection("x").distinct("field")');
    } finally {
      activeStub = stub;
    }
  });

  it("shows idle hint when displayMode is none", () => {
    const { getByText } = render(QueryTab, { props });
    expect(getByText(/Edit the statement/)).toBeTruthy();
  });

  it("shows the Builder button next to Script when the statement is an aggregate() call", () => {
    const { container } = render(QueryTab, { props });
    const modeToggle = within(container.querySelector(".mode-toggle")!);
    expect(modeToggle.getByText("Script", { exact: false })).toBeTruthy();
    expect(modeToggle.getByText("Builder", { exact: false })).toBeTruthy();
  });

  it("hides the Builder button when the statement isn't an aggregate() call", () => {
    const findStub = { ...stub, get statementText() { return 'db.getCollection("x").find({})'; } };
    activeStub = findStub as unknown as typeof stub;
    try {
      const { container } = render(QueryTab, { props });
      const modeToggle = within(container.querySelector(".mode-toggle")!);
      expect(modeToggle.getByText("Script", { exact: false })).toBeTruthy();
      expect(modeToggle.queryByText("Builder", { exact: false })).toBeNull();
    } finally {
      activeStub = stub;
    }
  });

  it("shows Grid, Tree and Console view toggle buttons in the result tab", () => {
    const { container } = render(QueryTab, { props });
    const viewToggle = within(container.querySelector(".view-toggle")!);
    expect(viewToggle.getByText("Grid")).toBeTruthy();
    expect(viewToggle.getByText("Tree")).toBeTruthy();
    expect(viewToggle.getByText("Console")).toBeTruthy();
  });

  it("switches to the tree view and renders docs as a virtualized tree", async () => {
    activeStub = editableStub as unknown as typeof stub;
    try {
      const { container } = render(QueryTab, { props });
      const viewToggle = within(container.querySelector(".view-toggle")!);
      await fireEvent.click(viewToggle.getByText("Tree"));
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
      const { getByText, container } = render(QueryTab, { props });
      const viewToggle = within(container.querySelector(".view-toggle")!);
      await fireEvent.click(viewToggle.getByText("Tree"));
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

  it("registers a logOpen/toggleLog bridge on activeDataView that collapses/expands the whole bottom pane", async () => {
    const { getByText, queryByText } = render(QueryTab, { props });
    // Normally set by the app shell (+page.svelte) as the active-tab tracking follows which
    // query tab is focused; this test stands in for that since QueryTab is rendered standalone.
    activeDataView.setActiveQueryId(props.id);
    expect(activeDataView.handle?.logOpen).toBe(true); // expanded by default
    expect(getByText("Result")).toBeTruthy();
    activeDataView.handle?.toggleLog?.();
    await Promise.resolve();
    expect(activeDataView.handle?.logOpen).toBe(false);
    expect(queryByText("Result")).toBeNull(); // whole bottom pane collapsed, editor takes full height
    activeDataView.handle?.toggleLog?.();
    await Promise.resolve();
    expect(activeDataView.handle?.logOpen).toBe(true);
    expect(getByText("Result")).toBeTruthy();
    activeDataView.setActiveQueryId(null);
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

  it("the result grid's Quick look opens the document drawer", async () => {
    activeStub = editableStub as unknown as typeof stub;
    // The virtualized grid only renders rows into a measured viewport (jsdom reports 0 by default).
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    try {
      const { getAllByRole, findByText } = render(QueryTab, { props });
      await fireEvent.click(getAllByRole("button", { name: "Quick look" })[0]);
      expect(await findByText("Document")).toBeTruthy();
      expect(await findByText('"test"')).toBeTruthy();
    } finally {
      activeStub = stub;
      if (desc) Object.defineProperty(HTMLElement.prototype, "offsetHeight", desc);
    }
  });
});

describe("QueryTab activeDataView bridge", () => {
  const props = { id: 1, seq: 1, initialStatement: "x", sessionId: "sess1", currentDb: "shop" };
  const bridgeStub = {
    ...editableStub,
    canEditSelected: true,
    canDeleteSelected: true,
    getSelectedForEdit: vi.fn(),
    requestDeleteSelected: vi.fn(),
    requestExportCurrent: vi.fn(),
  } as unknown as typeof stub;

  it("registers a handle on mount (regardless of active), and unregisters it on destroy", () => {
    activeStub = bridgeStub;
    try {
      const { unmount } = render(QueryTab, { props: { ...props, active: false } });
      activeDataView.setActiveQueryId(props.id);
      expect(activeDataView.handle).not.toBeNull();
      expect(activeDataView.handle?.canEdit).toBe(true);
      expect(activeDataView.handle?.canDelete).toBe(true);
      unmount();
      expect(activeDataView.handle).toBeNull(); // id still "active", but its entry is gone
    } finally {
      activeStub = stub;
      activeDataView.setActiveQueryId(null);
    }
  });

  it("stays registered across active flips — only setActiveQueryId decides resolution", async () => {
    activeStub = bridgeStub;
    try {
      const { rerender, unmount } = render(QueryTab, { props: { ...props, active: true } });
      activeDataView.setActiveQueryId(props.id);
      const handle = activeDataView.handle;
      expect(handle).not.toBeNull();
      await rerender({ ...props, active: false });
      expect(activeDataView.handle).toBe(handle); // deactivating the tab doesn't unregister it
      await rerender({ ...props, active: true });
      expect(activeDataView.handle).toBe(handle);
      unmount();
      expect(activeDataView.handle).toBeNull();
    } finally {
      activeStub = stub;
      activeDataView.setActiveQueryId(null);
    }
  });

  it("both tabs stay registered when mounted simultaneously; resolution follows setActiveQueryId only", async () => {
    activeStub = bridgeStub;
    try {
      const a = render(QueryTab, { props: { ...props, id: 1, active: true } });
      const b = render(QueryTab, { props: { ...props, id: 2, active: false } });
      activeDataView.setActiveQueryId(1);
      const handleA = activeDataView.handle;
      expect(handleA).not.toBeNull();

      // Simulate switching the active work tab from A to B (both flip in the same reactive flush,
      // as they do in +page.svelte). Regardless of which sibling's effect runs first, both stay
      // registered; the app shell's setActiveQueryId call is the sole source of truth.
      await b.rerender({ ...props, id: 2, active: true });
      await a.rerender({ ...props, id: 1, active: false });
      activeDataView.setActiveQueryId(2);
      expect(activeDataView.handle).not.toBe(handleA);
      expect(activeDataView.handle).not.toBeNull();

      activeDataView.setActiveQueryId(1);
      expect(activeDataView.handle).toBe(handleA); // switching back resolves the same, still-registered handle

      a.unmount();
      b.unmount();
      expect(activeDataView.handle).toBeNull();
    } finally {
      activeStub = stub;
      activeDataView.setActiveQueryId(null);
    }
  });

  it("canExport is false when the query hasn't run (no docs), true once it has results", () => {
    activeStub = { ...stub, docs: [] } as unknown as typeof stub;
    try {
      const { unmount } = render(QueryTab, { props: { ...props, active: true } });
      activeDataView.setActiveQueryId(props.id);
      expect(activeDataView.handle?.canExport).toBe(false);
      unmount();
    } finally {
      activeStub = stub;
      activeDataView.setActiveQueryId(null);
    }

    activeStub = bridgeStub;
    try {
      const { unmount } = render(QueryTab, { props: { ...props, active: true } });
      activeDataView.setActiveQueryId(props.id);
      expect(activeDataView.handle?.canExport).toBe(true);
      unmount();
    } finally {
      activeStub = stub;
      activeDataView.setActiveQueryId(null);
    }
  });

  it("canExport reflects whichever tab id is set active, regardless of registration/switch order", async () => {
    stubsById.set(1, bridgeStub); // tab A: has docs
    stubsById.set(2, { ...stub, docs: [] } as unknown as typeof stub); // tab B: no docs
    try {
      const a = render(QueryTab, { props: { ...props, id: 1, active: true } });
      const b = render(QueryTab, { props: { ...props, id: 2, active: false } });
      activeDataView.setActiveQueryId(1);
      expect(activeDataView.handle?.canExport).toBe(true); // A active, has docs

      await b.rerender({ ...props, id: 2, active: true });
      await a.rerender({ ...props, id: 1, active: false });
      activeDataView.setActiveQueryId(2);
      expect(activeDataView.handle?.canExport).toBe(false); // B active, no docs

      await a.rerender({ ...props, id: 1, active: true });
      await b.rerender({ ...props, id: 2, active: false });
      activeDataView.setActiveQueryId(1);
      expect(activeDataView.handle?.canExport).toBe(true); // back to A, still has docs

      a.unmount();
      b.unmount();
    } finally {
      stubsById.clear();
      activeDataView.setActiveQueryId(null);
    }
  });
});
