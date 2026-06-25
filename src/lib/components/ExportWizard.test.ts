import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/svelte";
import ExportWizard from "./ExportWizard.svelte";

vi.mock("../stores/namespaceTree.svelte", () => ({
  namespaceTree: { databases: [{ name: "shop", collections: ["users"] }] },
}));

describe("ExportWizard", () => {
  it("pick mode renders the collection tree", () => {
    const { getByText } = render(ExportWizard, {
      props: { input: { mode: "pick", preChecked: [] }, onclose: vi.fn() },
    });
    expect(getByText("shop")).toBeTruthy();
    expect(getByText("users")).toBeTruthy();
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
