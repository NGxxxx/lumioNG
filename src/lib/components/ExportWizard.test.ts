import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
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
