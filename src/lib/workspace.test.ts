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
});
