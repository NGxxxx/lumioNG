import { describe, it, expect } from "vitest";
import { createNavigation } from "./navigation.svelte";

const editDoc = (id: string) =>
  ({ kind: "document", db: "d", coll: "c", mode: "edit", initial: {}, idText: id }) as const;
const insertDoc = (db: string, coll: string) =>
  ({ kind: "document", db, coll, mode: "insert", initial: null, idText: null }) as const;

describe("navigation selection", () => {
  it("ban đầu rỗng", () => {
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

  it("selectCollection → contextTabs đủ 5, active mặc định data", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("shop", "users");
    expect(n.selection).toEqual({ db: "shop", coll: "users" });
    expect(n.level).toBe("coll");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data", "query"]);
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("đổi collection giữ nguyên tab data", () => {
    const n = createNavigation();
    n.selectCollection("shop", "a");
    n.showContext("data");
    n.selectCollection("shop", "b");
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("đổi collection giữ nguyên tab collection", () => {
    const n = createNavigation();
    n.selectCollection("shop", "a");
    n.showContext("collection");
    n.selectCollection("shop", "b");
    expect(n.active).toEqual({ zone: "context", kind: "collection" });
  });

  it("từ database tab, chọn collection → reset về data", () => {
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
  it("openDocument insert luôn mới + active work", () => {
    const n = createNavigation();
    n.openDocument(insertDoc("d", "c"));
    n.openDocument(insertDoc("d", "c"));
    expect(n.workTabs.length).toBe(2);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[1].id });
  });

  it("openDocument edit dedup theo idText", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"1"}'));
    expect(n.workTabs.length).toBe(1);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[0].id });
  });

  it("activateWork đổi active", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    const first = n.workTabs[0].id;
    n.activateWork(first);
    expect(n.active).toEqual({ zone: "work", id: first });
  });

  it("closeWork active → lùi work tab kề", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    n.closeWork(n.workTabs[1].id);
    expect(n.workTabs.length).toBe(1);
    expect(n.active).toEqual({ zone: "work", id: n.workTabs[0].id });
  });

  it("closeWork work tab cuối → fallback context data khi đang chọn collection", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "c"));
    n.closeWork(n.workTabs[0].id);
    expect(n.workTabs.length).toBe(0);
    expect(n.active).toEqual({ zone: "context", kind: "data" });
  });

  it("closeWork work tab cuối, không selection → active null", () => {
    const n = createNavigation();
    n.openDocument(insertDoc("d", "c"));
    n.closeWork(n.workTabs[0].id);
    expect(n.active).toBeNull();
  });

  it("closeWork tab không active → giữ active", () => {
    const n = createNavigation();
    n.openDocument(editDoc('{"$oid":"1"}'));
    n.openDocument(editDoc('{"$oid":"2"}'));
    const before = n.active;
    n.closeWork(n.workTabs[0].id);
    expect(n.active).toEqual(before);
  });
});

describe("contextTabs với connected/host/query", () => {
  it("chưa connected → rỗng", () => {
    const n = createNavigation();
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual([]);
  });
  it("connected, chưa chọn → chỉ host", () => {
    const n = createNavigation();
    n.setConnected(true);
    expect(n.contextTabs).toEqual(["host"]);
  });
  it("connected + db → host, database", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectDatabase("shop");
    expect(n.contextTabs).toEqual(["host", "database"]);
  });
  it("connected + coll → host, database, collection, data, query", () => {
    const n = createNavigation();
    n.setConnected(true);
    n.selectCollection("shop", "orders");
    expect(n.contextTabs).toEqual(["host", "database", "collection", "data", "query"]);
  });
});

describe("navigation refresh + DDL reconcile", () => {
  it("bumpCollection/collectionVersion theo db.coll", () => {
    const n = createNavigation();
    expect(n.collectionVersion("d", "c")).toBe(0);
    n.bumpCollection("d", "c");
    expect(n.collectionVersion("d", "c")).toBe(1);
    expect(n.collectionVersion("d", "x")).toBe(0);
  });

  it("closeForCollection đóng work tab + hạ selection xuống db", () => {
    const n = createNavigation();
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "c"));
    n.closeForCollection("d", "c");
    expect(n.workTabs.length).toBe(0);
    expect(n.selection).toEqual({ db: "d", coll: null });
    expect(n.active).toEqual({ zone: "context", kind: "database" });
  });

  it("closeForCollection không trúng selection thì giữ selection", () => {
    const n = createNavigation();
    n.selectCollection("d", "other");
    n.closeForCollection("d", "c");
    expect(n.selection).toEqual({ db: "d", coll: "other" });
  });

  it("closeForDatabase đóng work tab của db + clear selection", () => {
    const n = createNavigation();
    n.selectCollection("d", "c");
    n.openDocument(insertDoc("d", "a"));
    n.openDocument(insertDoc("other", "z"));
    n.closeForDatabase("d");
    expect(n.workTabs.length).toBe(1);
    expect(n.workTabs[0].db).toBe("other");
    expect(n.selection).toBeNull();
    expect(n.active).toBeNull();
  });

  it("renameCollectionTabs đổi tên work tab + selection + bump version", () => {
    const n = createNavigation();
    n.selectCollection("d", "old");
    n.openDocument(insertDoc("d", "old"));
    n.renameCollectionTabs("d", "old", "new");
    expect(n.workTabs[0].coll).toBe("new");
    expect(n.selection).toEqual({ db: "d", coll: "new" });
    expect(n.collectionVersion("d", "new")).toBe(1);
  });
});
