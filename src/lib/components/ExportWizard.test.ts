import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ExportWizard from "./ExportWizard.svelte";
import { buildTargets, targetKey } from "../domain/exportPlan";
import { handleModalKeydown } from "#lib/stores/modalStack.js";
import { saveDialog } from "../api/files";

vi.mock("../api/files", () => ({
  saveDialog: vi.fn().mockResolvedValue(null), // resolving null short-circuits start() before any real export runs
  openDirDialog: vi.fn().mockResolvedValue(null),
}));

// Pick mode must read the ACTIVE session's tree, not the dead module-level
// namespaceTree singleton (which is empty/stale under multi-session).
const activeTree = vi.hoisted(() => ({ databases: [{ name: "shop", collections: ["users", "orders"] }] }));
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: { id: "conn:1", tree: activeTree } },
}));

vi.mock("../stores/exportJob.svelte", () => ({
  createExportJob: () => ({
    rows: [{ db: "shop", coll: "users", status: "running", done: 0, total: 0 }],
    running: true, done: false, overall: { percent: 10 }, succeeded: 0, failed: 0,
    run: () => new Promise(() => {}), cancel: vi.fn(),
  }),
}));

describe("ExportWizard", () => {
  it("pick mode renders the active session's collection tree", () => {
    const { getByText } = render(ExportWizard, {
      props: { input: { mode: "pick", preChecked: [] }, onclose: vi.fn() },
    });
    expect(getByText("shop")).toBeTruthy();
    expect(getByText("users")).toBeTruthy();
    expect(getByText("orders")).toBeTruthy();
  });

  it("buildTargets over the active session's tree yields the wired targets", () => {
    const checked = new Set([targetKey("shop", "users")]);
    const targets = buildTargets(activeTree.databases, checked);
    expect(targets).toEqual([{ db: "shop", coll: "users" }]);
  });

  it("scoped mode renders the summary and columns", () => {
    const { getByText } = render(ExportWizard, {
      props: {
        input: { mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [{ path: "_id", visible: true }, { path: "name", visible: true }], summary: "Filtered rows" },
        onclose: vi.fn(),
      },
    });
    expect(getByText("Filtered rows")).toBeTruthy();
    expect(getByText("name")).toBeTruthy();
  });
});

describe("ExportWizard — nested-field notice", () => {
  it("no notice for the default JSON format even with a lossy column selected", () => {
    const { queryByText } = render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [{ path: "tags", visible: true, type: "array" }],
          summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    expect(queryByText(/nested field/)).toBeNull();
  });

  it("CSV shows the notice for a selected array-typed leaf column", async () => {
    const { getByText } = render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [
            { path: "_id", visible: true, type: "objectId" },
            { path: "tags", visible: true, type: "array" },
          ],
          summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    await fireEvent.click(getByText("CSV"));
    expect(getByText("1 nested field(s) will be stored as JSON text — not guaranteed to round-trip through other tools.")).toBeTruthy();
  });

  it("SQL counts a dotted leaf's top-level parent once, not per selected leaf", async () => {
    const { getByText } = render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [
            { path: "address.city", visible: true, type: "string" },
            { path: "address.zip", visible: true, type: "int" },
          ],
          summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    await fireEvent.click(getByText("SQL"));
    expect(getByText("1 nested field(s) will be stored as JSON text — not guaranteed to round-trip through other tools.")).toBeTruthy();
  });

  it("CSV shows no notice for the same dotted columns SQL flags (CSV flattens losslessly)", async () => {
    const { getByText, queryByText } = render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [
            { path: "address.city", visible: true, type: "string" },
            { path: "address.zip", visible: true, type: "int" },
          ],
          summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    await fireEvent.click(getByText("CSV"));
    expect(queryByText(/nested field/)).toBeNull();
  });

  it("deselecting the only lossy column removes the notice", async () => {
    const { getByText, queryByText } = render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [{ path: "tags", visible: true, type: "array" }],
          summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    await fireEvent.click(getByText("CSV"));
    expect(getByText(/nested field/)).toBeTruthy();
    await fireEvent.click(getByText("tags"));
    expect(queryByText(/nested field/)).toBeNull();
  });
});

describe("ExportWizard — keyboard", () => {
  it("Enter triggers the same export start as clicking the primary button", () => {
    render(ExportWizard, {
      props: {
        input: {
          mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null,
          columns: [{ path: "_id", visible: true }], summary: "Filtered rows",
        },
        onclose: vi.fn(),
      },
    });
    handleModalKeydown({ key: "Enter", target: null } as unknown as KeyboardEvent);
    expect(saveDialog).toHaveBeenCalled();
  });

  it("Escape closes when nothing is running", () => {
    const onclose = vi.fn();
    render(ExportWizard, { props: { input: { mode: "pick", preChecked: [] }, onclose } });
    handleModalKeydown({ key: "Escape", target: null } as unknown as KeyboardEvent);
    expect(onclose).toHaveBeenCalled();
  });

  it("Run in background closes the wizard and leaves the job in the jobs registry", async () => {
    const { jobs } = await import("../stores/jobs.svelte");
    vi.mocked(saveDialog).mockResolvedValueOnce("/tmp/users.json");
    const onclose = vi.fn();
    const { findByRole, getByRole } = render(ExportWizard, {
      props: {
        input: { mode: "scopedCollection", db: "shop", coll: "users", filter: "{}", sort: null, columns: [{ path: "_id", visible: true }], summary: "All" },
        onclose,
      },
    });
    const before = jobs.running;
    await fireEvent.click(getByRole("button", { name: "Export" }));
    await fireEvent.click(await findByRole("button", { name: "Run in background" }));
    expect(onclose).toHaveBeenCalled();
    expect(jobs.running).toBe(before + 1);
    expect(jobs.list.at(-1)?.source.label).toBe("Exporting users.json");
  });
});
