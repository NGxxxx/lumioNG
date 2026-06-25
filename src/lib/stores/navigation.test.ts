import { describe, it, expect } from "vitest";
import { createSessionNav } from "./navigation.svelte";

// The per-session navigation slice holds tree selection + collection-section state.
// The shared tab strip (work tabs, active zone, DDL tab cleanup) lives in sessionManager
// and is exercised in sessionManager.test.ts.

describe("session nav selection", () => {
  it("initial state is empty", () => {
    const n = createSessionNav();
    expect(n.selection).toBeNull();
    expect(n.level).toBe("none");
    expect(n.contextTabs).toEqual([]);
  });

  it("selectDatabase → selection db, contextTabs=[host,database]", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.selection).toEqual({ db: "shop", coll: null });
    expect(n.level).toBe("db");
    expect(n.contextTabs).toEqual(["host", "database"]);
  });

  it("selectCollection → selection coll, 4 contextTabs", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "users");
    expect(n.selection).toEqual({ db: "shop", coll: "users" });
    expect(n.level).toBe("coll");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data"]);
  });

  it("setCollectionSection updates the section", () => {
    const n = createSessionNav();
    n.selectCollection("d", "c");
    expect(n.collectionSection).toBe("info");
    n.setCollectionSection("indexes");
    expect(n.collectionSection).toBe("indexes");
  });

  it("setConnected(false) clears selection", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("d", "c");
    n.setConnected(false);
    expect(n.selection).toBeNull();
    expect(n.contextTabs).toEqual([]);
  });
});

describe("session nav contextTabs with connection and selection state", () => {
  it("not connected → contextTabs is empty", () => {
    const n = createSessionNav();
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual([]);
  });
  it("connected, no selection → host only", () => {
    const n = createSessionNav();
    n.setConnected(true);
    expect(n.contextTabs).toEqual(["host"]);
  });
  it("connected + db selected → host, database", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.contextTabs).toEqual(["host", "database"]);
  });
  it("connected + collection selected → host, database, collection, data", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data"]);
  });
  it("query is not a context tab", () => {
    const n = createSessionNav();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).not.toContain("query");
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
