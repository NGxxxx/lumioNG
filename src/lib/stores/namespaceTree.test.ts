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
import { createNavigation } from "./navigation.svelte";
import { commandLog } from "./commandLog.svelte";
import {
  createCollectionCmd,
  dropCollectionCmd,
  renameCollectionCmd,
  dropDatabaseCmd,
} from "../domain/mongosh";

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
    const nt = createNamespaceTree(createNavigation());
    await nt.refresh();
    expect(nt.databases).toEqual([{ name: "d", collections: ["c"] }]);
  });

  it("refresh lỗi → set error, không ném", async () => {
    listNs.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const nt = createNamespaceTree(createNavigation());
    await nt.refresh();
    expect(nt.error).toContain("boom");
  });

  it("createCollection hợp lệ → gọi api + refresh", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.createCollection("d", "users");
    expect(createColl).toHaveBeenCalledWith("d", "users");
    expect(listNs).toHaveBeenCalled();
  });

  it("createCollection tên xấu → ném, không gọi api", async () => {
    const nt = createNamespaceTree(createNavigation());
    await expect(nt.createCollection("d", "a$b")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
  });

  it("createDatabase validate cả db lẫn coll", async () => {
    const nt = createNamespaceTree(createNavigation());
    await expect(nt.createDatabase("a/b", "c")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
    await nt.createDatabase("shop", "users");
    expect(createColl).toHaveBeenCalledWith("shop", "users");
  });

  it("dropCollection → api + đóng work tab khớp + hạ selection + refresh", async () => {
    const nav = createNavigation();
    nav.selectCollection("d", "c");
    nav.openDocument({ kind: "document", db: "d", coll: "c", mode: "insert", initial: null, idText: null });
    const nt = createNamespaceTree(nav);
    await nt.dropCollection("d", "c");
    expect(dropColl).toHaveBeenCalledWith("d", "c");
    expect(nav.workTabs.length).toBe(0);
    expect(nav.selection).toEqual({ db: "d", coll: null });
    expect(listNs).toHaveBeenCalled();
  });

  it("renameCollection → api + selection theo tên mới", async () => {
    const nav = createNavigation();
    nav.selectCollection("d", "old");
    const nt = createNamespaceTree(nav);
    await nt.renameCollection("d", "old", "new");
    expect(renameColl).toHaveBeenCalledWith("d", "old", "new");
    expect(nav.selection).toEqual({ db: "d", coll: "new" });
  });

  it("dropDatabase → api + đóng work tab + clear selection", async () => {
    const nav = createNavigation();
    nav.selectCollection("d", "a");
    nav.openDocument({ kind: "document", db: "d", coll: "a", mode: "insert", initial: null, idText: null });
    const nt = createNamespaceTree(nav);
    await nt.dropDatabase("d");
    expect(dropDb).toHaveBeenCalledWith("d");
    expect(nav.workTabs.length).toBe(0);
    expect(nav.selection).toBeNull();
  });
});

describe("namespaceTree command log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNs.mockResolvedValue([]);
    commandLog.clear();
  });

  it("createCollection đẩy createCollectionCmd", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.createCollection("shop", "users");
    expect(commandLog.entries.at(-1)!.text).toBe(createCollectionCmd("users"));
  });

  it("createDatabase đẩy createCollectionCmd", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.createDatabase("shop", "orders");
    expect(commandLog.entries.at(-1)!.text).toBe(createCollectionCmd("orders"));
  });

  it("dropCollection đẩy dropCollectionCmd", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.dropCollection("shop", "users");
    expect(commandLog.entries.at(-1)!.text).toBe(dropCollectionCmd("users"));
  });

  it("renameCollection đẩy renameCollectionCmd(from, to)", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.renameCollection("shop", "old", "new");
    expect(commandLog.entries.at(-1)!.text).toBe(renameCollectionCmd("old", "new"));
  });

  it("dropDatabase đẩy dropDatabaseCmd", async () => {
    const nt = createNamespaceTree(createNavigation());
    await nt.dropDatabase("shop");
    expect(commandLog.entries.at(-1)!.text).toBe(dropDatabaseCmd());
  });
});
