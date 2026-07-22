import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/admin", () => ({
  createCollection: vi.fn(),
  dropCollection: vi.fn(),
  renameCollection: vi.fn(),
  duplicateCollection: vi.fn(),
  dropDatabase: vi.fn(),
  truncateCollection: vi.fn(),
}));
vi.mock("../api/connection", () => ({
  listNamespaces: vi.fn(),
}));

import * as admin from "../api/admin";
import * as connection from "../api/connection";
import { createNamespaceTree, type NavLike } from "./namespaceTree.svelte";
import { commandLog } from "./commandLog.svelte";
import { activity } from "./activity.svelte";
import {
  createCollectionCmd,
  dropCollectionCmd,
  renameCollectionCmd,
  duplicateCollectionCmd,
  dropDatabaseCmd,
  truncateCollectionCmd,
  listDatabasesCmd,
} from "../domain/mongosh";

const createColl = admin.createCollection as ReturnType<typeof vi.fn>;
const dropColl = admin.dropCollection as ReturnType<typeof vi.fn>;
const renameColl = admin.renameCollection as ReturnType<typeof vi.fn>;
const duplicateColl = admin.duplicateCollection as ReturnType<typeof vi.fn>;
const dropDb = admin.dropDatabase as ReturnType<typeof vi.fn>;
const truncateMock = admin.truncateCollection as ReturnType<typeof vi.fn>;
const listNs = connection.listNamespaces as ReturnType<typeof vi.fn>;

/** Tracking nav double: records the cleanup calls the tree forwards on DDL. */
function mockNav() {
  const calls = {
    closeForCollection: [] as Array<[string, string]>,
    closeForDatabase: [] as string[],
    renameCollectionTabs: [] as Array<[string, string, string]>,
  };
  const nav: NavLike = {
    closeForCollection: (db, coll) => calls.closeForCollection.push([db, coll]),
    closeForDatabase: (db) => calls.closeForDatabase.push(db),
    renameCollectionTabs: (db, o, n) => calls.renameCollectionTabs.push([db, o, n]),
  };
  return { nav, calls };
}

describe("createNamespaceTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNs.mockResolvedValue([]);
  });

  it("refresh loads databases", async () => {
    listNs.mockResolvedValueOnce([{ name: "d", collections: ["c"] }]);
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.refresh();
    expect(nt.databases).toEqual([{ name: "d", collections: ["c"] }]);
  });

  it("refresh error sets error and does not throw", async () => {
    listNs.mockRejectedValueOnce({ kind: "Query", message: "boom" });
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.refresh();
    expect(nt.error).toContain("boom");
  });

  it("createCollection with valid name calls api and refreshes", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.createCollection("d", "users");
    expect(createColl).toHaveBeenCalledWith("conn:1", "d", "users");
    expect(listNs).toHaveBeenCalledWith("conn:1", false);
  });

  it("createCollection with invalid name throws and does not call api", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await expect(nt.createCollection("d", "a$b")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
  });

  it("createDatabase validates both db and collection names", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await expect(nt.createDatabase("a/b", "c")).rejects.toBeTruthy();
    expect(createColl).not.toHaveBeenCalled();
    await nt.createDatabase("shop", "users");
    expect(createColl).toHaveBeenCalledWith("conn:1", "shop", "users");
  });

  it("dropCollection calls api, forwards tab cleanup, and refreshes", async () => {
    const { nav, calls } = mockNav();
    const nt = createNamespaceTree("conn:1", nav);
    await nt.dropCollection("d", "c");
    expect(dropColl).toHaveBeenCalledWith("conn:1", "d", "c");
    expect(calls.closeForCollection).toEqual([["d", "c"]]);
    expect(listNs).toHaveBeenCalledWith("conn:1", false);
  });

  it("renameCollection calls api and forwards tab rename", async () => {
    const { nav, calls } = mockNav();
    const nt = createNamespaceTree("conn:1", nav);
    await nt.renameCollection("d", "old", "new");
    expect(renameColl).toHaveBeenCalledWith("conn:1", "d", "old", "new");
    expect(calls.renameCollectionTabs).toEqual([["d", "old", "new"]]);
  });

  it("duplicateCollection with valid name calls api and refreshes", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.duplicateCollection("d", "orders", "orders_copy");
    expect(duplicateColl).toHaveBeenCalledWith("conn:1", "d", "orders", "orders_copy");
    expect(listNs).toHaveBeenCalledWith("conn:1", false);
  });

  it("duplicateCollection with invalid target name throws and does not call api", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await expect(nt.duplicateCollection("d", "orders", "a$b")).rejects.toBeTruthy();
    expect(duplicateColl).not.toHaveBeenCalled();
  });

  it("dropDatabase calls api, forwards tab cleanup, and refreshes", async () => {
    const { nav, calls } = mockNav();
    const nt = createNamespaceTree("conn:1", nav);
    await nt.dropDatabase("d");
    expect(dropDb).toHaveBeenCalledWith("conn:1", "d");
    expect(calls.closeForDatabase).toEqual(["d"]);
    expect(listNs).toHaveBeenCalledWith("conn:1", false);
  });

  it("truncate calls admin.truncateCollection and refreshes", async () => {
    truncateMock.mockResolvedValue(3);
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.truncate("db", "coll");
    expect(truncateMock).toHaveBeenCalledWith("conn:1", "db", "coll");
    expect(listNs).toHaveBeenCalledWith("conn:1", false);
  });

  it("clear empties cached databases (disconnect)", async () => {
    listNs.mockResolvedValueOnce([{ name: "d", collections: ["c"] }]);
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.refresh();
    expect(nt.databases.length).toBe(1);
    nt.clear();
    expect(nt.databases).toEqual([]);
    expect(nt.error).toBeNull();
  });
});

describe("namespaceTree command log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNs.mockResolvedValue([]);
    commandLog.clear();
  });

  it("createCollection pushes createCollectionCmd with a measured duration", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.createCollection("shop", "users");
    // createCollection also awaits refresh(), which now logs its own listDatabasesCmd read
    // afterward, so the DDL command is no longer necessarily the last entry.
    const entry = commandLog.entries.find((e) => e.text === createCollectionCmd("users"));
    expect(entry).toBeDefined();
    expect(entry!.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("createDatabase pushes createCollectionCmd to the command log", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.createDatabase("shop", "orders");
    expect(commandLog.entries.some((e) => e.text === createCollectionCmd("orders"))).toBe(true);
  });

  it("dropCollection pushes dropCollectionCmd to the command log", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.dropCollection("shop", "users");
    expect(commandLog.entries.some((e) => e.text === dropCollectionCmd("users"))).toBe(true);
  });

  it("renameCollection pushes renameCollectionCmd(from, to) to the command log", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.renameCollection("shop", "old", "new");
    expect(commandLog.entries.some((e) => e.text === renameCollectionCmd("old", "new"))).toBe(true);
  });

  it("duplicateCollection pushes duplicateCollectionCmd(source, target) to the command log", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.duplicateCollection("shop", "orders", "orders_copy");
    expect(commandLog.entries.some((e) => e.text === duplicateCollectionCmd("orders", "orders_copy"))).toBe(true);
  });

  it("dropDatabase pushes dropDatabaseCmd to the command log", async () => {
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.dropDatabase("shop");
    expect(commandLog.entries.some((e) => e.text === dropDatabaseCmd())).toBe(true);
  });

  it("truncate pushes truncateCollectionCmd to the command log", async () => {
    truncateMock.mockResolvedValue(5);
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.truncate("shop", "orders");
    expect(commandLog.entries.some((e) => e.text === truncateCollectionCmd("orders"))).toBe(true);
  });

  it("refresh pushes listDatabasesCmd with a measured duration", async () => {
    listNs.mockResolvedValueOnce([{ name: "d", collections: ["c"] }]);
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.refresh();
    const entry = commandLog.entries.at(-1)!;
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
  });
});

describe("namespaceTree activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNs.mockResolvedValue([]);
  });

  it("createCollection reports busy while the DDL call is in flight", async () => {
    let sawBusy = false;
    createColl.mockImplementationOnce(async () => {
      sawBusy = activity.busy;
    });
    const nt = createNamespaceTree("conn:1", mockNav().nav);
    await nt.createCollection("d", "users");
    expect(sawBusy).toBe(true);
    expect(activity.busy).toBe(false);
  });
});
