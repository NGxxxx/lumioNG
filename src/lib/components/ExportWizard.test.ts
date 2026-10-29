import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ExportWizard from "./ExportWizard.svelte";
import { buildTargets, targetKey } from "../domain/exportPlan";
import { handleModalKeydown } from "#lib/stores/modalStack.js";
import { saveDialog } from "../api/files";
import { settings } from "../stores/settings.svelte";

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

const csfleOn = vi.hoisted(() => ({ value: false }));
vi.mock("../stores/csfle.svelte", () => ({ csfle: { sessionEnabled: vi.fn(async () => csfleOn.value) } }));

// The dialog starts from the last export's choices; every test starts from the defaults.
beforeEach(() => settings.setExportPrefs("json", false));

describe("ExportWizard — encryption notice", () => {
  it("says decrypted values are written to the file on an encrypting session only", async () => {
    csfleOn.value = true;
    const on = render(ExportWizard, { props: { input: { mode: "pick", preChecked: [] }, onclose: vi.fn() } });
    expect((await on.findByTestId("csfle-export-notice")).textContent).toMatch(/plain text/);
    on.unmount();
    csfleOn.value = false;
    const off = render(ExportWizard, { props: { input: { mode: "pick", preChecked: [] }, onclose: vi.fn() } });
    await new Promise((r) => setTimeout(r, 30));
    expect(off.queryByTestId("csfle-export-notice")).toBeNull();
  });
});

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

describe("ExportWizard — remembered choices", () => {
  const scoped = {
    mode: "scopedCollection" as const, db: "d", coll: "c", filter: "{}", sort: null,
    columns: [{ path: "_id", visible: true }], summary: "All",
  };

  it("starts from the last format and metadata choice, and explains the format", () => {
    settings.setExportPrefs("csv", true);
    const { getByLabelText, getByText } = render(ExportWizard, { props: { input: scoped, onclose: vi.fn() } });
    expect((getByLabelText("CSV") as HTMLInputElement).checked).toBe(true);
    expect((getByLabelText(/Include indexes/) as HTMLInputElement).checked).toBe(true);
    expect(getByText(/flat table for spreadsheets/)).toBeTruthy();
  });

  it("BSON from last time falls back to JSON for rows held in memory", () => {
    settings.setExportPrefs("bson", false);
    const { getByLabelText } = render(ExportWizard, {
      props: { input: { mode: "scopedMemory", coll: "c", docs: [], columns: [{ path: "_id", visible: true }], summary: "Rows" }, onclose: vi.fn() },
    });
    expect((getByLabelText("JSON") as HTMLInputElement).checked).toBe(true);
  });
});

describe("ExportWizard — filter box", () => {
  it("narrows the collection list; Select all then only ticks the visible matches", async () => {
    const { getByPlaceholderText, queryByText, getByText } = render(ExportWizard, {
      props: { input: { mode: "pick", preChecked: [] }, onclose: vi.fn() },
    });
    await fireEvent.input(getByPlaceholderText("Filter databases or collections…"), { target: { value: "ORD" } });
    expect(getByText("orders")).toBeTruthy();
    expect(queryByText("users")).toBeNull();
    await fireEvent.click(getByText("Select all"));
    expect(getByText("1 selected")).toBeTruthy();
    await fireEvent.input(getByPlaceholderText("Filter databases or collections…"), { target: { value: "zzz" } });
    expect(getByText("Nothing matches “zzz”.")).toBeTruthy();
  });
});
