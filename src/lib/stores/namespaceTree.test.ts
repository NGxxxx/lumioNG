import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/admin", () => ({
  createCollection: vi.fn(),
  dropCollection: vi.fn(),
  renameCollection: vi.fn(),
  dropDatabase: vi.fn(),
}));
vi.mock("../api/connection", () => ({
  listNamespaces: vi.fn(),
}));

import * as admin from "../api/admin";
import * as connection from "../api/connection";
import { createNamespaceTree } from "./namespaceTree.svelte";
import { createWorkspace } from "./workspace.svelte";

const createColl = admin.createCollection as ReturnType<typeof vi.fn>;
const dropColl = admin.dropCollection as ReturnType<typeof vi.fn>;
const renameColl = admin.renameCollection as ReturnType<typeof vi.fn>;
const dropDb = admin.dropDatabase as ReturnType<typeof vi.fn>;
const listNs = connection.listNamespaces as ReturnType<typeof vi.fn>;

describe("createNamespaceTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNs.mockResolvedValue([]);
  });

  it("refresh nạp databases", async () => {
    listNs.mockResolvedValueOnce([{ name: "d", collections: ["c"] }]);
    const nt = createNamespaceTree(createWorkspace());
    await nt.refresh();
    expect(nt.databases).toEqual([{ name: "d", collections: ["c"] }]);
  });

  it("refresh lỗi → set error, không ném", async () => {
    listNs.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const nt = createNamespaceTree(createWorkspace());
    await nt.refresh();
    expect(nt.error).toContain("boom");
  });

  it("createCollection hợp lệ → gọi api + refresh", async () => {
    const nt = createNamespaceTree(createWorkspace());
    await nt.createCollection("d", "users");
    expect(createColl).toHaveBeenCalledWith("d", "users");
    expect(listNs).toHaveBeenCalled();
  });

  it("createCollection tên xấu → ném, không gọi api", async () => {
    const nt = createNamespaceTree(createWorkspace());
    await expect(nt.createCollection("d", "a$b")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
  });

  it("createDatabase validate cả db lẫn coll", async () => {
    const nt = createNamespaceTree(createWorkspace());
    await expect(nt.createDatabase("a/b", "c")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
    await nt.createDatabase("shop", "users");
    expect(createColl).toHaveBeenCalledWith("shop", "users");
  });

  it("dropCollection → api + đóng tab khớp + refresh", async () => {
    const ws = createWorkspace();
    ws.openCollection("d", "c");
    const nt = createNamespaceTree(ws);
    await nt.dropCollection("d", "c");
    expect(dropColl).toHaveBeenCalledWith("d", "c");
    expect(ws.tabs.length).toBe(0);
    expect(listNs).toHaveBeenCalled();
  });

  it("renameCollection → api + tab theo tên mới", async () => {
    const ws = createWorkspace();
    ws.openCollection("d", "old");
    const nt = createNamespaceTree(ws);
    await nt.renameCollection("d", "old", "new");
    expect(renameColl).toHaveBeenCalledWith("d", "old", "new");
    expect((ws.tabs[0] as { coll: string }).coll).toBe("new");
  });

  it("dropDatabase → api + đóng mọi tab trong db", async () => {
    const ws = createWorkspace();
    ws.openCollection("d", "a");
    ws.openCollection("d", "b");
    const nt = createNamespaceTree(ws);
    await nt.dropDatabase("d");
    expect(dropDb).toHaveBeenCalledWith("d");
    expect(ws.tabs.length).toBe(0);
  });
});
