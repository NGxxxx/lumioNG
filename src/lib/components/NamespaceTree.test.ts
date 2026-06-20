import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import NamespaceTree from "./NamespaceTree.svelte";

const databases = [{ name: "shop", collections: ["users"] }];

describe("NamespaceTree", () => {
  it("nút New database → onnewdatabase", async () => {
    const onnewdatabase = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onnewdatabase } });
    await fireEvent.click(getByText("＋ New database"));
    expect(onnewdatabase).toHaveBeenCalled();
  });

  it("right-click collection → onmenu kind=coll", async () => {
    const onmenu = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onmenu } });
    await fireEvent.contextMenu(getByText("users"));
    expect(onmenu).toHaveBeenCalledWith(expect.objectContaining({ kind: "coll", db: "shop", coll: "users" }));
  });

  it("right-click db → onmenu kind=db", async () => {
    const onmenu = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onmenu } });
    await fireEvent.contextMenu(getByText("shop"));
    expect(onmenu).toHaveBeenCalledWith(expect.objectContaining({ kind: "db", db: "shop" }));
  });

  it("left-click collection vẫn gọi onselect", async () => {
    const onselect = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onselect } });
    await fireEvent.click(getByText("users"));
    expect(onselect).toHaveBeenCalledWith({ db: "shop", coll: "users" });
  });

  it("caret thu/mở: click db ẩn rồi hiện lại collection", async () => {
    const { getByText, queryByText } = render(NamespaceTree, { props: { databases } });
    expect(getByText("users")).toBeTruthy();
    await fireEvent.click(getByText("shop"));
    expect(queryByText("users")).toBeNull(); // đã thu
    await fireEvent.click(getByText("shop"));
    expect(getByText("users")).toBeTruthy(); // mở lại
  });

  it("footer đếm databases + collections", () => {
    const dbs = [
      { name: "a", collections: ["x", "y"] },
      { name: "b", collections: ["z"] },
    ];
    const { getByText } = render(NamespaceTree, { props: { databases: dbs } });
    expect(getByText("2 databases · 3 collections")).toBeTruthy();
  });

  it("hiện node connection khi có prop connection", () => {
    const { getByText } = render(NamespaceTree, { props: { databases, connection: { label: "Local" } } });
    expect(getByText("Local")).toBeTruthy();
  });

  it("left-click db → onselectdb (vẫn toggle thu/mở)", async () => {
    const onselectdb = vi.fn();
    const { getByText } = render(NamespaceTree, { props: { databases, onselectdb } });
    await fireEvent.click(getByText("shop"));
    expect(onselectdb).toHaveBeenCalledWith({ db: "shop" });
  });
});
