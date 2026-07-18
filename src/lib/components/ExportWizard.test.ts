import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ExportWizard from "./ExportWizard.svelte";
import { buildTargets, targetKey } from "../domain/exportPlan";

// Pick mode must read the ACTIVE session's tree, not the dead module-level
// namespaceTree singleton (which is empty/stale under multi-session).
const activeTree = vi.hoisted(() => ({ databases: [{ name: "shop", collections: ["users", "orders"] }] }));
vi.mock("../stores/sessionManager.svelte", () => ({
  sessionManager: { active: { id: "conn:1", tree: activeTree } },
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
