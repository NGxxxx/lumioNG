import { describe, it, expect } from "vitest";
import { createWorkspace } from "./workspace.svelte";

describe("workspace tabs", () => {
  it("openCollection dedup theo db.coll", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "c");
    ws.openCollection("d", "c");
    expect(ws.tabs.length).toBe(1);
    expect(ws.activeId).toBe(ws.tabs[0].id);
  });

  it("openCollection mở các collection khác nhau", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.openCollection("d", "b");
    expect(ws.tabs.length).toBe(2);
    expect(ws.activeId).toBe(ws.tabs[1].id);
  });

  it("openDocument edit dedup theo idText; insert luôn mới", () => {
    const ws = createWorkspace();
    ws.openDocument({ kind: "document", db: "d", coll: "c", mode: "edit", initial: {}, idText: '{"$oid":"1"}' });
    ws.openDocument({ kind: "document", db: "d", coll: "c", mode: "edit", initial: {}, idText: '{"$oid":"1"}' });
    expect(ws.tabs.length).toBe(1);
    ws.openDocument({ kind: "document", db: "d", coll: "c", mode: "insert", initial: null, idText: null });
    ws.openDocument({ kind: "document", db: "d", coll: "c", mode: "insert", initial: null, idText: null });
    expect(ws.tabs.length).toBe(3);
  });

  it("close tab active → focus tab kề trái", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.openCollection("d", "b");
    ws.openCollection("d", "c");
    const mid = ws.tabs[1].id;
    ws.activate(mid);
    ws.close(mid);
    expect(ws.tabs.length).toBe(2);
    expect(ws.activeId).toBe(ws.tabs[0].id);
  });

  it("close tab cuối cùng → activeId null", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.close(ws.tabs[0].id);
    expect(ws.tabs.length).toBe(0);
    expect(ws.activeId).toBeNull();
  });

  it("bumpCollection tăng version theo db.coll", () => {
    const ws = createWorkspace();
    expect(ws.collectionVersion("d", "c")).toBe(0);
    ws.bumpCollection("d", "c");
    expect(ws.collectionVersion("d", "c")).toBe(1);
    expect(ws.collectionVersion("d", "other")).toBe(0);
  });

  it("close tab đầu khi có nhiều tab → focus tab kế bên phải", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.openCollection("d", "b");
    ws.openCollection("d", "c");
    const first = ws.tabs[0].id;
    ws.activate(first);
    ws.close(first);
    expect(ws.tabs.length).toBe(2);
    expect(ws.activeId).toBe(ws.tabs[0].id); // tab "b" giờ ở index 0
  });

  it("closeForCollection đóng cả collection-tab lẫn document-tab của coll đó", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "c");
    ws.openDocument({ kind: "document", db: "d", coll: "c", mode: "insert", initial: null, idText: null });
    ws.openCollection("d", "other");
    ws.closeForCollection("d", "c");
    expect(ws.tabs.length).toBe(1);
    expect((ws.tabs[0] as { coll: string }).coll).toBe("other");
  });

  it("closeForDatabase đóng mọi tab thuộc db", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.openCollection("d", "b");
    ws.openCollection("other", "z");
    ws.closeForDatabase("d");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].db).toBe("other");
  });

  it("renameCollectionTabs trỏ tab sang tên mới + bump version tên mới", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "old");
    expect(ws.collectionVersion("d", "new")).toBe(0);
    ws.renameCollectionTabs("d", "old", "new");
    expect((ws.tabs[0] as { coll: string }).coll).toBe("new");
    expect(ws.collectionVersion("d", "new")).toBe(1);
  });

  it("openIndexes mở tab index và dedup", () => {
    const ws = createWorkspace();
    ws.openIndexes("d", "c");
    ws.openIndexes("d", "c");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].kind).toBe("index");
  });

  it("closeForCollection đóng cả index tab của coll đó", () => {
    const ws = createWorkspace();
    ws.openCollection("d", "c");
    ws.openIndexes("d", "c");
    ws.closeForCollection("d", "c");
    expect(ws.tabs.length).toBe(0);
  });

  it("renameCollectionTabs đổi tên cả index tab", () => {
    const ws = createWorkspace();
    ws.openIndexes("d", "old");
    ws.renameCollectionTabs("d", "old", "new");
    expect((ws.tabs[0] as { coll: string }).coll).toBe("new");
    expect(ws.tabs[0].kind).toBe("index");
  });

  it("openCollectionInfo mở tab collinfo và dedup", () => {
    const ws = createWorkspace();
    ws.openCollectionInfo("d", "c");
    ws.openCollectionInfo("d", "c");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].kind).toBe("collinfo");
  });

  it("openDatabaseStats mở tab dbstats và dedup", () => {
    const ws = createWorkspace();
    ws.openDatabaseStats("d");
    ws.openDatabaseStats("d");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].kind).toBe("dbstats");
  });

  it("closeForCollection đóng collinfo nhưng KHÔNG đụng dbstats", () => {
    const ws = createWorkspace();
    ws.openCollectionInfo("d", "c");
    ws.openDatabaseStats("d");
    ws.closeForCollection("d", "c");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].kind).toBe("dbstats");
  });

  it("renameCollectionTabs đổi tên collinfo nhưng KHÔNG đụng dbstats", () => {
    const ws = createWorkspace();
    ws.openCollectionInfo("d", "old");
    ws.openDatabaseStats("d");
    ws.renameCollectionTabs("d", "old", "new");
    const info = ws.tabs.find((t) => t.kind === "collinfo");
    expect(info && "coll" in info ? info.coll : null).toBe("new");
    expect(ws.tabs.some((t) => t.kind === "dbstats")).toBe(true);
  });

  it("closeForDatabase đóng cả collinfo lẫn dbstats của db", () => {
    const ws = createWorkspace();
    ws.openCollectionInfo("d", "c");
    ws.openDatabaseStats("d");
    ws.openCollection("other", "z");
    ws.closeForDatabase("d");
    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].db).toBe("other");
  });
});
