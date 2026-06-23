import { describe, it, expect } from "vitest";
import { createNavigation } from "./navigation.svelte";

const editDoc = (id: string) =>
  ({ kind: "document", db: "d", coll: "c", mode: "edit", initial: {}, idText: id }) as const;
const insertDoc = (db: string, coll: string) =>
  ({ kind: "document", db, coll, mode: "insert", initial: null, idText: null }) as const;

describe("navigation selection", () => {
  it("initial state is empty", () => {
    const n = createNavigation();
    expect(n.selection).toBeNull();
    expect(n.level).toBe("none");
    expect(n.contextTabs).toEqual([]);
    expect(n.active).toBeNull();
  });

  it("selectDatabase → selection db, contextTabs=[host,database], active database", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.selection).toEqual({ db: "shop", coll: null });
    expect(n.level).toBe("db");
    expect(n.contextTabs).toEqual(["host", "database"]);
    expect(n.active).toEqual({ zone: "context", kind: "database" });
  });

  it("selectCollection → 4 contextTabs, active defaults to data", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("shop", "users");
    expect(n.selection).toEqual({ db: "shop", coll: "users" });
    expect(n.level).toBe("coll");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data"]);
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("switching collection preserves the data tab", () => {
    const n = createNavigation();
    n.selectCollection("shop", "a");
    n.showContext("data");
    n.selectCollection("shop", "b");
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("switching collection preserves the collection tab", () => {
    const n = createNavigation();
    n.selectCollection("shop", "a");
    n.showContext("collection");
    n.selectCollection("shop", "b");
    expect(n.active).toEqual({ zone: "context", kind: "collection" });
  });

  it("selecting a collection from the database tab resets active to data", () => {
    const n = createNavigation();
    n.selectDatabase("shop");
    n.selectCollection("shop", "users");
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("showContext + setCollectionSection", () => {
    const n = createNavigation();
    n.selectCollection("d", "c");
    n.showContext("collection");
    expect(n.active).toEqual({ zone: "context", kind: "collection" });
    expect(n.collectionSection).toBe("info");
    n.setCollectionSection("indexes");
    expect(n.collectionSection).toBe("indexes");
  });
});

describe("navigation work tabs", () => {
  it("openDocument insert always opens a new tab and activates it", () => {
    const n = createNavigation();
    n.openDocument(insertDoc("d", "c"));
    n.openDocument(insertDoc("d", "c"));
    expect(n.workTabs.length).toBe(2);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[1].id });
  });

  it("openDocument edit deduplicates by idText", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"1"}'));
    expect(n.workTabs.length).toBe(1);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[0].id });
  });

  it("activateWork changes the active tab", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    const first = n.workTabs[0].id;
    n.activateWork(first);
    expect(n.active).toEqual({ zone: "work", id: first });
  });

  it("closeWork on active tab → falls back to the adjacent work tab", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    n.closeWork(n.workTabs[1].id);
    expect(n.workTabs.length).toBe(1);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[0].id });
  });

  it("closeWork last work tab → fallback to context data when a collection is selected", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "c"));
    n.closeWork(n.workTabs[0].id);
    expect(n.workTabs.length).toBe(0);
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("closeWork last work tab with no selection → active becomes null", () => {
    const n = createNavigation();
    n.openDocument(insertDoc("d", "c"));
    n.closeWork(n.workTabs[0].id);
    expect(n.active).toBeNull();
  });

  it("closeWork on an inactive tab → keeps active unchanged", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    const before = n.active;
    n.closeWork(n.workTabs[0].id);
    expect(n.active).toEqual(before);
  });
});

describe("contextTabs with connection and selection state", () => {
  it("not connected → contextTabs is empty", () => {
    const n = createNavigation();
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual([]);
  });
  it("connected, no selection → host only", () => {
    const n = createNavigation();
    n.setConnected(true);
    expect(n.contextTabs).toEqual(["host"]);
  });
  it("connected + db selected → host, database", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.contextTabs).toEqual(["host", "database"]);
  });
  it("connected + collection selected → host, database, collection, data", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data"]);
  });
});

describe("navigation refresh + DDL reconcile", () => {
  it("bumpCollection/collectionVersion track versions per db.coll", () => {
    const n = createNavigation();
    expect(n.collectionVersion("d", "c")).toBe(0);
    n.bumpCollection("d", "c");
    expect(n.collectionVersion("d", "c")).toBe(1);
    expect(n.collectionVersion("d", "x")).toBe(0);
  });

  it("closeForCollection closes work tabs and demotes selection to db level", () => {
    const n = createNavigation();
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "c"));
    n.closeForCollection("d", "c");
    expect(n.workTabs.length).toBe(0);
    expect(n.selection).toEqual({ db: "d", coll: null });
    expect(n.active).toEqual({ zone: "context", kind: "database" });
  });

  it("closeForCollection with a non-matching selection leaves selection unchanged", () => {
    const n = createNavigation();
    n.selectCollection("d", "other");
    n.closeForCollection("d", "c");
    expect(n.selection).toEqual({ db: "d", coll: "other" });
  });

  it("closeForDatabase closes work tabs for the db and clears selection", () => {
    const n = createNavigation();
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "a"));
    n.openDocument(insertDoc("other", "z"));
    n.closeForDatabase("d");
    expect(n.workTabs.length).toBe(1);
    const tab0 = n.workTabs[0];
    if (tab0.kind !== "document") throw new Error("expected document tab");
    expect(tab0.db).toBe("other");
    expect(n.selection).toBeNull();
    expect(n.active).toBeNull();
  });

  it("renameCollectionTabs updates work tab names, selection, and bumps version", () => {
    const n = createNavigation();
    n.selectCollection("d", "old");
    n.openDocument(insertDoc("d", "old"));
    n.renameCollectionTabs("d", "old", "new");
    const renamed = n.workTabs[0];
    if (renamed.kind !== "document") throw new Error("expected document tab");
    expect(renamed.coll).toBe("new");
    expect(n.selection).toEqual({ db: "d", coll: "new" });
    expect(n.collectionVersion("d", "new")).toBe(1);
  });

  it("collectionVersion is independent per collection", () => {
    const nav = createNavigation();
    expect(nav.collectionVersion("db", "a")).toBe(0);
    expect(nav.collectionVersion("db", "b")).toBe(0);
    nav.bumpCollection("db", "a");
    expect(nav.collectionVersion("db", "a")).toBe(1);
    expect(nav.collectionVersion("db", "b")).toBe(0); // independent
  });
});

describe("navigation query work tabs", () => {
  it("openQuery adds a persistent query tab with an incrementing seq", () => {
    const nav = createNavigation();
    nav.setConnected(true);
    nav.selectCollection("shop", "orders");
    nav.openQuery('db.getCollection("orders").aggregate([])');
    nav.openQuery('db.getCollection("orders").aggregate([])');
    const queries = nav.workTabs.filter((t) => t.kind === "query");
    expect(queries.map((t) => (t.kind === "query" ? t.seq : 0))).toEqual([1, 2]);
    expect(nav.active).toEqual({ zone: "work", id: queries[1].id });
  });

  it("query tabs survive a selection change", () => {
    const nav = createNavigation();
    nav.setConnected(true);
    nav.selectCollection("shop", "orders");
    nav.openQuery('db.getCollection("orders").aggregate([])');
    nav.selectCollection("shop", "users");
    expect(nav.workTabs.filter((t) => t.kind === "query").length).toBe(1);
  });

  it("query is no longer a context tab", () => {
    const nav = createNavigation();
    nav.setConnected(true);
    nav.selectCollection("shop", "orders");
    expect(nav.contextTabs).not.toContain("query");
  });

  it("reuses the lowest free Query number after closing", () => {
    const nav = createNavigation();
    nav.setConnected(true);
    nav.openQuery("a");
    nav.openQuery("b"); // #1, #2
    const first = nav.workTabs.find((t) => t.kind === "query" && t.seq === 1)!;
    nav.closeWork(first.id);
    nav.openQuery("c"); // should reuse #1
    expect(nav.workTabs.filter((t) => t.kind === "query").map((t) => (t.kind === "query" ? t.seq : 0)).sort()).toEqual([1, 2]);
  });
});
