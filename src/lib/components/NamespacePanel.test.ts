import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";

vi.mock("../stores/namespaceTree.svelte", () => ({
  namespaceTree: {
    get databases() {
      return [{ name: "shop", collections: ["users"] }];
    },
    get error() {
      return null;
    },
    refresh: vi.fn(),
    createDatabase: vi.fn(),
    createCollection: vi.fn(),
    dropCollection: vi.fn(),
    renameCollection: vi.fn(),
    dropDatabase: vi.fn(),
    truncate: vi.fn(),
  },
}));

vi.mock("../api/files", () => ({
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../api/documents", () => ({
  exportQuery: vi.fn(),
  exportBson: vi.fn(),
  importDocuments: vi.fn(),
  importBson: vi.fn(),
}));

import NamespacePanel from "./NamespacePanel.svelte";

describe("NamespacePanel", () => {
  it("collection menu shows Export/Import/Truncate; db menu has no Stats", async () => {
    const { getByText, queryByText } = render(NamespacePanel, { props: {} });

    // Open collection context menu
    await fireEvent.contextMenu(getByText("users"));
    expect(getByText("Export…")).toBeTruthy();
    expect(getByText("Import…")).toBeTruthy();
    expect(getByText("Truncate…")).toBeTruthy();

    // Close collection menu by pressing Escape
    await fireEvent.keyDown(window, { key: "Escape" });

    // Open db context menu
    await fireEvent.contextMenu(getByText("shop"));
    expect(queryByText("Stats")).toBeNull();
  });

  it("collection menu: Copy name copies db.coll to clipboard", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
    });
    const { getByText } = render(NamespacePanel, { props: {} });
    await fireEvent.contextMenu(getByText("users"));
    await fireEvent.click(getByText("Copy name"));
    expect(writeText).toHaveBeenCalledWith("shop.users");
  });

  it("db menu shows New collection… / Copy name / Refresh / Drop database…", async () => {
    const { getByText } = render(NamespacePanel, { props: {} });
    await fireEvent.contextMenu(getByText("shop"));
    expect(getByText("New collection…")).toBeTruthy();
    expect(getByText("Copy name")).toBeTruthy();
    expect(getByText("Refresh")).toBeTruthy();
    expect(getByText("Drop database…")).toBeTruthy();
  });
});
