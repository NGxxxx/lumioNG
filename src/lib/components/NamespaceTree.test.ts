import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NamespaceTree from "./NamespaceTree.svelte";

const databases = [{ name: "shop", collections: ["users"] }];

describe("NamespaceTree", () => {
  it("right-click collection → onmenu kind=coll", async () => {
    const onmenu = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onmenu } });
    await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
    await fireEvent.contextMenu(getByText("users"));
    expect(onmenu).toHaveBeenCalledWith(expect.objectContaining({ kind: "coll", db: "shop", coll: "users" }));
  });

  it("right-click db → onmenu kind=db", async () => {
    const onmenu = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onmenu } });
    await fireEvent.contextMenu(getByText("shop"));
    expect(onmenu).toHaveBeenCalledWith(expect.objectContaining({ kind: "db", db: "shop" }));
  });

  // Regression: the contextmenu must NOT bubble to document/window, otherwise the
  // ContextMenu's own window oncontextmenu={onclose} closes the menu on the same event.
  it("right-click stops propagation (menu would self-close otherwise)", async () => {
    const onmenu = vi.fn();
    const bubbled = vi.fn();
    document.addEventListener("contextmenu", bubbled);
    try {
      const { getByText } = render(NamespaceTree, { props: { databases, onmenu } });
      await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
      await fireEvent.contextMenu(getByText("users"));
      expect(onmenu).toHaveBeenCalled();
      expect(bubbled).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("contextmenu", bubbled);
    }
  });

  it("left-click collection still calls onselect", async () => {
    const onselect = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onselect } });
    await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
    await fireEvent.click(getByText("users"));
    expect(onselect).toHaveBeenCalledWith({ db: "shop", coll: "users" });
  });

  it("databases start collapsed; clicking db shows then hides its collections again", async () => {
    const { getByText, queryByText } = render(NamespaceTree, { props: { databases } });
    expect(queryByText("users")).toBeNull(); // collapsed by default
    await fireEvent.click(getByText("shop"));
    expect(getByText("users")).toBeTruthy(); // expanded
    await fireEvent.click(getByText("shop"));
    expect(queryByText("users")).toBeNull(); // collapsed again
  });

  it("footer shows database and collection counts", () => {
    const dbs = [
      { name: "a", collections: ["x", "y"] },
      { name: "b", collections: ["z"] },
    ];
    const { getByText } = render(NamespaceTree, { props: { databases: dbs } });
    expect(getByText("2 databases · 3 collections")).toBeTruthy();
  });

  it("double-click collection → ondblselect", async () => {
    const ondblselect = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, ondblselect } });
    await fireEvent.click(getByText("shop")); // expand — collections are collapsed by default
    await fireEvent.doubleClick(getByText("users"));
    expect(ondblselect).toHaveBeenCalledWith({ db: "shop", coll: "users" });
  });

  it("left-click db → onselectdb (still toggles collapse/expand)", async () => {
    const onselectdb = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onselectdb } });
    await fireEvent.click(getByText("shop"));
    expect(onselectdb).toHaveBeenCalledWith({ db: "shop" });
  });
});
