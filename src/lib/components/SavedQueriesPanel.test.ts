import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../api/queryLibrary", () => ({
  loadQueryLibrary: vi.fn().mockResolvedValue([]),
  saveQueryLibrary: vi.fn().mockResolvedValue(undefined),
}));

import { queryLibrary } from "../stores/queryLibrary.svelte";
import { shell } from "../stores/shell.svelte";
import SavedQueriesPanel from "./SavedQueriesPanel.svelte";

describe("SavedQueriesPanel", () => {
  beforeEach(async () => {
    await queryLibrary.load(); // resets nodes to [] via the mock
    if (!shell.savedQueriesOpen) shell.toggleSavedQueries();
  });

  it("shows the empty state when the library is empty", () => {
    const { getByText } = render(SavedQueriesPanel, { onopen: () => {} });
    expect(getByText("No saved queries")).toBeTruthy();
  });

  it("renders saved rows and opens a query on double-click", async () => {
    await queryLibrary.saveQuery("Active users", "db.u.find()", "app", null);
    const onopen = vi.fn();
    const { getByText } = render(SavedQueriesPanel, { onopen });
    await fireEvent.dblClick(getByText("Active users"));
    expect(onopen).toHaveBeenCalledWith(expect.objectContaining({ name: "Active users", statement: "db.u.find()" }));
  });

  it("header + button opens the new-folder dialog and creates a root folder", async () => {
    const { getByLabelText, getByText } = render(SavedQueriesPanel, { onopen: () => {} });
    await fireEvent.click(getByLabelText("New folder"));
    await fireEvent.input(getByLabelText("Folder name"), { target: { value: "Reports" } });
    await fireEvent.click(getByText("OK"));
    expect(queryLibrary.nodes).toContainEqual(expect.objectContaining({ kind: "folder", name: "Reports", parentId: null }));
  });

  it("collapses the body when the header is clicked", async () => {
    const { getByText, queryByText } = render(SavedQueriesPanel, { onopen: () => {} });
    await fireEvent.click(getByText("Saved Queries"));
    expect(queryByText("No saved queries")).toBeNull();
    shell.toggleSavedQueries(); // restore for other tests
  });
});
