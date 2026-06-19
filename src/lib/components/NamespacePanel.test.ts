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
  },
}));

import NamespacePanel from "./NamespacePanel.svelte";

describe("NamespacePanel", () => {
  it("right-click collection → menu Indexes → onopenindexes", async () => {
    const onopenindexes = vi.fn();
    const { getByText } = render(NamespacePanel, { props: { onopenindexes } });
    await fireEvent.contextMenu(getByText("users"));
    await fireEvent.click(getByText("Indexes"));
    expect(onopenindexes).toHaveBeenCalledWith({ db: "shop", coll: "users" });
  });

  it("right-click collection → menu Info → onopeninfo", async () => {
    const onopeninfo = vi.fn();
    const { getByText } = render(NamespacePanel, { props: { onopeninfo } });
    await fireEvent.contextMenu(getByText("users"));
    await fireEvent.click(getByText("Info"));
    expect(onopeninfo).toHaveBeenCalledWith({ db: "shop", coll: "users" });
  });

  it("right-click database → menu Stats → onopendbstats", async () => {
    const onopendbstats = vi.fn();
    const { getByText } = render(NamespacePanel, { props: { onopendbstats } });
    await fireEvent.contextMenu(getByText("shop"));
    await fireEvent.click(getByText("Stats"));
    expect(onopendbstats).toHaveBeenCalledWith({ db: "shop" });
  });
});
