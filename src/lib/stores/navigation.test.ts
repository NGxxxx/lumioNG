import { describe, it, expect } from "vitest";
import { createSessionNav } from "./navigation.svelte";

// The per-session navigation slice holds tree selection + which destination page/view is shown.
// The shared tab strip (work tabs, active zone, DDL tab cleanup) lives in sessionManager
// and is exercised in sessionManager.test.ts.

describe("session nav selection", () => {
  it("initial state is empty", () => {
    const n = createSessionNav();
    expect(n.selection).toBeNull();
    expect(n.level).toBe("none");
    expect(n.page).toBeNull();
  });

  it("page is null until connected, host after connect", () => {
    const n = createSessionNav();
    expect(n.page).toBeNull();
    n.setConnected(true);
    expect(n.page).toBe("host");
  });

  it("selectDatabase opens the database page", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.selection).toEqual({ db: "shop", coll: null });
    expect(n.level).toBe("db");
    expect(n.page).toBe("database");
  });

  it("selectCollection opens the collection page on the data view", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.setCollectionView("indexes");
    n.selectCollection("shop", "orders");
    expect(n.selection).toEqual({ db: "shop", coll: "orders" });
    expect(n.level).toBe("coll");
    expect(n.page).toBe("collection");
    expect(n.collectionView).toBe("data");
  });

  it("setCollectionView switches the collection view", () => {
    const n = createSessionNav();
    n.selectCollection("d", "c");
    n.setCollectionView("schema");
    expect(n.collectionView).toBe("schema");
  });

  it("switching the collection view from the host page opens the collection page", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    n.selectHost();
    n.setCollectionView("schema");
    expect(n.page).toBe("collection");
  });

  it("selectHost keeps the tree selection", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    n.selectHost();
    expect(n.page).toBe("host");
    expect(n.selection).toEqual({ db: "shop", coll: "orders" });
  });

  it("clearCollection falls back to the database page; clearSelection to host", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    n.clearCollection();
    expect(n.page).toBe("database");
    n.clearSelection();
    expect(n.page).toBe("host");
  });

  it("setConnected(false) clears selection and page", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("d", "c");
    n.setConnected(false);
    expect(n.selection).toBeNull();
    expect(n.page).toBeNull();
  });
});

describe("session nav collection versions", () => {
  it("bumpCollection/collectionVersion track versions per db.coll", () => {
    const n = createSessionNav();
    expect(n.collectionVersion("d", "c")).toBe(0);
    n.bumpCollection("d", "c");
    expect(n.collectionVersion("d", "c")).toBe(1);
    expect(n.collectionVersion("d", "x")).toBe(0);
  });

  it("collectionVersion is independent per collection", () => {
    const n = createSessionNav();
    expect(n.collectionVersion("db", "a")).toBe(0);
    expect(n.collectionVersion("db", "b")).toBe(0);
    n.bumpCollection("db", "a");
    expect(n.collectionVersion("db", "a")).toBe(1);
    expect(n.collectionVersion("db", "b")).toBe(0); // independent
  });
});

describe("host section", () => {
  it("defaults to info and can switch to users", () => {
    const n = createSessionNav();
    expect(n.hostSection).toBe("info");
    n.setHostSection("users");
    expect(n.hostSection).toBe("users");
  });
});
